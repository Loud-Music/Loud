package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

var lrcStamp = regexp.MustCompile(`\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]`)

func validateLRC(value string, duration float64) error {
	if value == "" {
		return nil
	}
	if len(value) > 200000 || strings.ContainsRune(value, '\x00') {
		return errors.New("LRC exceeds 200 KB or contains invalid characters")
	}
	stamps := lrcStamp.FindAllStringSubmatch(value, -1)
	if len(stamps) == 0 {
		return errors.New("LRC must contain timestamps like [00:12.50]")
	}
	for _, stamp := range stamps {
		minutes, _ := strconv.Atoi(stamp[1])
		seconds, _ := strconv.Atoi(stamp[2])
		if float64(minutes*60+seconds) > duration+15 {
			return errors.New("LRC timestamps exceed track duration")
		}
	}
	return nil
}

type LyricsCandidate struct {
	ID           int64   `json:"id"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	Duration     float64 `json:"duration"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

func (store *Store) detectLyrics(w http.ResponseWriter, r *http.Request, owner, id int64) {
	store.mu.Lock()
	data, err := decodeCatalog(store.file, store)
	if err != nil {
		store.mu.Unlock()
		writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
		return
	}
	drafts, err := store.drafts()
	if err != nil {
		store.mu.Unlock()
		writeJSON(w, r, 503, map[string]string{"error": "Draft storage unavailable"})
		return
	}
	for _, draft := range drafts {
		if data.releases[draft.Release.ID].ID == 0 {
			addDraft(data, draft)
		}
	}
	track := data.tracks[id]
	if track.ID == 0 || data.releases[track.ReleaseID].DistributorID != owner {
		store.mu.Unlock()
		writeJSON(w, r, 404, map[string]string{"error": "Track not found"})
		return
	}
	artistNames := []string{}
	for _, artistID := range track.ArtistIDs {
		artistNames = append(artistNames, data.artists[artistID].Name)
	}
	store.mu.Unlock()
	query := url.Values{"track_name": {track.Title}, "artist_name": {strings.Join(artistNames, ", ")}}
	request, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://lrclib.net/api/search?"+query.Encode(), nil)
	request.Header.Set("User-Agent", "LOUD-Catalog/1.0 (https://github.com/Loud-Music/Loud)")
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		writeJSON(w, r, 502, map[string]string{"error": "Lyrics search unavailable. Try again."})
		return
	}
	defer response.Body.Close()
	items := []LyricsCandidate{}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&items) != nil {
		writeJSON(w, r, 502, map[string]string{"error": "Lyrics search unavailable"})
		return
	}
	matches := []LyricsCandidate{}
	for _, item := range items {
		if normalized(item.TrackName) != normalized(track.Title) || math.Abs(item.Duration-track.Duration) > 3 || validateLRC(item.SyncedLyrics, track.Duration) != nil || item.SyncedLyrics == "" {
			continue
		}
		if !slices.ContainsFunc(artistNames, func(name string) bool { return normalized(name) == normalized(item.ArtistName) }) && normalized(item.ArtistName) != normalized(strings.Join(artistNames, ", ")) {
			continue
		}
		matches = append(matches, item)
		if len(matches) == 5 {
			break
		}
	}
	slices.SortStableFunc(matches, func(a, b LyricsCandidate) int {
		left, right := math.Abs(a.Duration-track.Duration), math.Abs(b.Duration-track.Duration)
		if left < right {
			return -1
		}
		if left > right {
			return 1
		}
		return 0
	})
	source := ""
	if len(matches) > 0 {
		source = fmt.Sprintf("https://lrclib.net/api/get/%d", matches[0].ID)
	}
	writeJSON(w, r, 200, map[string]any{"data": matches, "source": source})
}
