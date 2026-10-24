package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

const origin = "https://api.mambo.wtf"
const maxCatalogBytes = 8 << 20

type Link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type Artist struct {
	Visibility    string   `json:"visibility,omitempty"`
	Banned        bool     `json:"banned,omitempty"`
	Deleted       bool     `json:"deleted,omitempty"`
	ID            int64    `json:"id"`
	DistributorID int64    `json:"distributorId,omitempty"`
	Name          string   `json:"name"`
	Picture       string   `json:"picture_xl,omitempty"`
	Banner        string   `json:"banner,omitempty"`
	Bio           string   `json:"bio,omitempty"`
	Description   string   `json:"description,omitempty"`
	Genres        []string `json:"genres,omitempty"`
	Links         []Link   `json:"links,omitempty"`
}

type Release struct {
	Visibility    string  `json:"visibility,omitempty"`
	PublishAt     string  `json:"publishAt,omitempty"`
	Presave       bool    `json:"presave,omitempty"`
	ID            int64   `json:"id"`
	DistributorID int64   `json:"distributorId,omitempty"`
	Title         string  `json:"title"`
	ArtistIDs     []int64 `json:"artistIds"`
	TrackIDs      []int64 `json:"trackIds"`
	Cover         string  `json:"cover"`
	ReleaseDate   string  `json:"release_date"`
	RecordType    string  `json:"record_type"`
}

type Track struct {
	Visibility      string  `json:"visibility,omitempty"`
	Banned          bool    `json:"banned,omitempty"`
	Cover           string  `json:"cover,omitempty"`
	LRC             string  `json:"lrc,omitempty"`
	LyricsSource    string  `json:"lyricsSource,omitempty"`
	ID              int64   `json:"id"`
	Title           string  `json:"title"`
	ArtistIDs       []int64 `json:"artistIds"`
	ReleaseID       int64   `json:"releaseId"`
	Duration        float64 `json:"duration"`
	Audio           string  `json:"audio"`
	Format          string  `json:"format"`
	DownloadAllowed *bool   `json:"downloadAllowed,omitempty"`
	SampleRate      int     `json:"sampleRate,omitempty"`
	BitDepth        int     `json:"bitDepth,omitempty"`
	DiscNumber      int     `json:"discNumber,omitempty"`
}

type Catalog struct {
	Version      int           `json:"version"`
	Distributors []Distributor `json:"distributors,omitempty"`
	Artists      []Artist      `json:"artists"`
	Releases     []Release     `json:"releases"`
	Tracks       []Track       `json:"tracks"`
	artists      map[int64]Artist
	releases     map[int64]Release
	tracks       map[int64]Track
	media        map[string]bool
	distributors map[int64]Distributor
}

type Store struct {
	mu      sync.Mutex
	file    string
	media   *os.Root
	current *Catalog
	stamp   time.Time
	size    int64
	uploads chan struct{}
}

func positiveID(id int64) bool { return id > 0 && id <= 9007199254740991 }

func validText(value string, limit int) bool {
	return strings.TrimSpace(value) != "" && len([]rune(value)) <= limit
}

func image(name string) bool {
	return slices.Contains([]string{".jpg", ".jpeg", ".png", ".webp", ".avif"}, strings.ToLower(path.Ext(name)))
}

func mediaName(name string) (string, error) {
	if !strings.HasPrefix(name, "/media/") || strings.ContainsAny(name, "%?#\\\x00") || path.Clean(name) != name {
		return "", errors.New("invalid media path")
	}
	relative := strings.TrimPrefix(name, "/media/")
	if relative == "" || !filepath.IsLocal(filepath.FromSlash(relative)) {
		return "", errors.New("invalid media path")
	}
	return filepath.FromSlash(relative), nil
}

func (store *Store) fileExists(name string) error {
	relative, err := mediaName(name)
	if err != nil {
		return err
	}
	file, err := store.media.Open(relative)
	if err != nil {
		return fmt.Errorf("media unavailable: %s", name)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() == 0 {
		return fmt.Errorf("invalid media file: %s", name)
	}
	return nil
}

func decodeCatalog(file string, store *Store) (*Catalog, error) {
	body, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	if len(body) > maxCatalogBytes {
		return nil, errors.New("catalog exceeds 8 MiB")
	}
	var data Catalog
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil {
		return nil, err
	}
	if decoder.Decode(new(any)) != io.EOF || data.Version != 1 || data.Artists == nil || data.Releases == nil || data.Tracks == nil {
		return nil, errors.New("invalid catalog document")
	}
	if len(data.Artists) > 20000 || len(data.Releases) > 20000 || len(data.Tracks) > 20000 {
		return nil, errors.New("catalog collection too large")
	}
	data.artists = make(map[int64]Artist)
	data.releases = make(map[int64]Release)
	data.tracks = make(map[int64]Track)
	data.media = make(map[string]bool)
	data.distributors = make(map[int64]Distributor)
	for _, distributor := range data.Distributors {
		if !positiveID(distributor.ID) || !validText(distributor.Name, 160) || data.distributors[distributor.ID].ID != 0 {
			return nil, errors.New("invalid or duplicate distributor")
		}
		data.distributors[distributor.ID] = distributor
	}
	for _, artist := range data.Artists {
		if !validVisibility(artist.Visibility) {
			return nil, errors.New("invalid artist visibility")
		}
		if !positiveID(artist.ID) || !validText(artist.Name, 160) || data.artists[artist.ID].ID != 0 {
			return nil, errors.New("invalid or duplicate artist")
		}
		if artist.DistributorID != 0 && data.distributors[artist.DistributorID].ID == 0 {
			return nil, errors.New("unknown artist distributor")
		}
		if len([]rune(artist.Bio)) > 10000 || len([]rune(artist.Description)) > 250 || len(artist.Genres) > 8 || len(artist.Links) > 8 {
			return nil, errors.New("artist metadata too large")
		}
		for _, genre := range artist.Genres {
			if !validText(genre, 60) {
				return nil, errors.New("invalid genre")
			}
		}
		for _, name := range []string{artist.Picture, artist.Banner} {
			if name != "" {
				if !image(name) {
					return nil, errors.New("artist artwork must be an image")
				}
				if err := store.fileExists(name); err != nil {
					return nil, err
				}
				data.media[name] = true
			}
		}
		for _, link := range artist.Links {
			u, err := url.Parse(link.URL)
			if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || !validText(link.Label, 60) || len(link.URL) > 2000 {
				return nil, errors.New("artist links must use HTTPS")
			}
		}
		data.artists[artist.ID] = artist
	}
	contributors := func(ids []int64) bool {
		if len(ids) == 0 || len(ids) > 40 {
			return false
		}
		seen := make(map[int64]bool)
		for _, id := range ids {
			if data.artists[id].ID == 0 || seen[id] {
				return false
			}
			seen[id] = true
		}
		return true
	}
	for _, release := range data.Releases {
		if !validVisibility(release.Visibility) {
			return nil, errors.New("invalid release visibility")
		}
		if release.PublishAt != "" {
			if _, err := time.Parse(time.RFC3339, release.PublishAt); err != nil {
				return nil, errors.New("publishAt must include a timezone")
			}
		}
		if !positiveID(release.ID) || data.releases[release.ID].ID != 0 || !validText(release.Title, 300) || !contributors(release.ArtistIDs) || !image(release.Cover) || release.TrackIDs == nil {
			return nil, errors.New("invalid release")
		}
		if !slices.Contains([]string{"album", "single", "ep"}, release.RecordType) {
			return nil, errors.New("invalid release type")
		}
		if release.DistributorID != 0 && data.distributors[release.DistributorID].ID == 0 {
			return nil, errors.New("unknown release distributor")
		}
		if _, err := time.Parse(time.DateOnly, release.ReleaseDate); err != nil {
			return nil, errors.New("invalid release date")
		}
		if err := store.fileExists(release.Cover); err != nil {
			return nil, err
		}
		data.media[release.Cover] = true
		data.releases[release.ID] = release
	}
	for _, track := range data.Tracks {
		if !validVisibility(track.Visibility) {
			return nil, errors.New("invalid track visibility")
		}
		if err := validateLRC(track.LRC, track.Duration); err != nil {
			return nil, err
		}
		if len(track.LyricsSource) > 1000 {
			return nil, errors.New("lyrics source too long")
		}
		if track.LyricsSource != "" && track.LyricsSource != "uploaded" {
			url, err := url.Parse(track.LyricsSource)
			if err != nil || url.Scheme != "https" || url.Host != "lrclib.net" || url.User != nil || !strings.HasPrefix(url.Path, "/api/get/") {
				return nil, errors.New("invalid lyrics source")
			}
		}
		if track.Cover != "" {
			if !image(track.Cover) {
				return nil, errors.New("invalid track artwork")
			}
			if err := store.fileExists(track.Cover); err != nil {
				return nil, err
			}
			data.media[track.Cover] = true
		}
		if !positiveID(track.ID) || data.tracks[track.ID].ID != 0 || !validText(track.Title, 300) || !contributors(track.ArtistIDs) {
			return nil, errors.New("invalid track")
		}
		if math.IsNaN(track.Duration) || math.IsInf(track.Duration, 0) || track.Duration <= 0 || track.Duration > 86400 || data.releases[track.ReleaseID].ID == 0 {
			return nil, errors.New("invalid track duration or release")
		}
		ext := strings.ToLower(path.Ext(track.Audio))
		if !(track.Format == "FLAC" && ext == ".flac" || track.Format == "MP3" && ext == ".mp3" || track.Format == "AAC" && (ext == ".aac" || ext == ".m4a")) {
			return nil, errors.New("audio extension does not match format")
		}
		if err := store.fileExists(track.Audio); err != nil {
			return nil, err
		}
		data.media[track.Audio] = true
		data.tracks[track.ID] = track
	}
	listed := make(map[int64]bool)
	for _, release := range data.Releases {
		for _, id := range release.TrackIDs {
			track, exists := data.tracks[id]
			if !exists || track.ReleaseID != release.ID || listed[id] {
				return nil, errors.New("invalid release tracklist")
			}
			listed[id] = true
		}
	}
	if len(listed) != len(data.Tracks) {
		return nil, errors.New("track missing from release tracklist")
	}
	return &data, nil
}

func (store *Store) load() (*Catalog, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	stat, err := os.Stat(store.file)
	if err != nil {
		return nil, err
	}
	if store.current == nil || stat.ModTime() != store.stamp || stat.Size() != store.size {
		if stat.Size() > maxCatalogBytes {
			return nil, errors.New("catalog too large")
		}
		value, err := decodeCatalog(store.file, store)
		if err != nil {
			return nil, err
		}
		store.current, store.stamp, store.size = value, stat.ModTime(), stat.Size()
	}
	return store.current, nil
}

func (data *Catalog) artistRecord(artist Artist) map[string]any {
	result := map[string]any{"id": artist.ID, "name": artist.Name, "catalog": "loud", "bio": artist.Bio, "description": artist.Description, "genres": artist.Genres, "links": artist.Links}
	if artist.Picture != "" {
		result["picture_xl"] = origin + artist.Picture
	}
	if artist.Banner != "" {
		result["banner"] = origin + artist.Banner
	}
	if distributor, exists := data.distributors[artist.DistributorID]; exists {
		result["distributor"] = distributor
	}
	return result
}

func (data *Catalog) trackRecord(track Track) map[string]any {
	release := data.releases[track.ReleaseID]
	artists := make([]string, 0, len(track.ArtistIDs))
	for _, id := range track.ArtistIDs {
		artists = append(artists, data.artists[id].Name)
	}
	quality := "lossy"
	if track.Format == "FLAC" {
		quality = "lossless"
	}
	result := map[string]any{
		"id": fmt.Sprintf("loud:%d", track.ID), "title": track.Title, "artist": strings.Join(artists, ", "), "artists": artists, "loudArtistIds": track.ArtistIDs,
		"loudReleaseId": track.ReleaseID,
		"album":         release.Title, "cover": origin + release.Cover, "duration": track.Duration, "source": "Loud", "src": origin + track.Audio, "remoteUrl": origin + track.Audio,
		"format": track.Format, "qualityHint": quality, "fullRecording": true, "downloadAllowed": track.DownloadAllowed == nil || *track.DownloadAllowed,
		"trackNumber": slices.Index(release.TrackIDs, track.ID) + 1, "discNumber": track.DiscNumber, "sampleRate": track.SampleRate, "bitDepth": track.BitDepth,
	}
	if track.Cover != "" {
		result["cover"] = origin + track.Cover
	}
	if !data.released(release) {
		delete(result, "src")
		delete(result, "remoteUrl")
		result["availableAt"] = release.PublishAt
		result["downloadAllowed"] = false
	}
	if track.LRC != "" && data.released(release) {
		result["lyricsUrl"] = fmt.Sprintf("%s/v1/tracks/%d/lyrics", origin, track.ID)
	}
	return result
}

func (data *Catalog) releaseRecord(release Release) map[string]any {
	tracks := make([]map[string]any, 0, len(release.TrackIDs))
	for _, id := range release.TrackIDs {
		if track := data.tracks[id]; data.trackVisible(track) {
			tracks = append(tracks, data.trackRecord(track))
		}
	}
	result := map[string]any{"id": fmt.Sprintf("loud:%d", release.ID), "title": release.Title, "cover_big": origin + release.Cover, "release_date": release.ReleaseDate, "record_type": release.RecordType, "tracks": tracks}
	result["publishAt"], result["presave"], result["available"] = release.PublishAt, release.Presave, data.released(release)
	if distributor, exists := data.distributors[release.DistributorID]; exists {
		result["distributor"] = distributor
	}
	return result
}

func normalized(value string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(value), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }), " ")
}

func writeJSON(w http.ResponseWriter, r *http.Request, code int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if code == http.StatusOK && !strings.HasPrefix(r.URL.Path, "/v1/distributor/") {
		w.Header().Set("Cache-Control", "public, max-age=30")
		if strings.HasPrefix(r.URL.Path, "/v1/releases/") || strings.HasPrefix(r.URL.Path, "/v1/artists/") || strings.HasPrefix(r.URL.Path, "/v1/tracks") {
			w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
		}
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
	w.WriteHeader(code)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func (store *Store) api(w http.ResponseWriter, r *http.Request) {
	data, err := store.load()
	if err != nil {
		log.Printf("catalog: %v", err)
		writeJSON(w, r, http.StatusServiceUnavailable, map[string]string{"error": "Catalog unavailable"})
		return
	}
	query := normalized(r.URL.Query().Get("query"))
	if len(query) > 600 {
		writeJSON(w, r, http.StatusBadRequest, map[string]string{"error": "Query too long"})
		return
	}
	switch {
	case r.URL.Path == "/health" || r.URL.Path == "/":
		writeJSON(w, r, http.StatusOK, map[string]any{"status": "ok", "catalogVersion": 1})
	case r.URL.Path == "/v1/distributors":
		items := data.Distributors
		if items == nil {
			items = []Distributor{}
		}
		writeJSON(w, r, http.StatusOK, map[string]any{"data": items})
	case r.URL.Path == "/v1/artists":
		items := make([]map[string]any, 0)
		for _, artist := range data.Artists {
			if data.artistVisible(artist.ID) && strings.Contains(normalized(artist.Name), query) {
				items = append(items, data.artistRecord(artist))
				if len(items) == 100 {
					break
				}
			}
		}
		writeJSON(w, r, http.StatusOK, map[string]any{"data": items})
	case strings.HasPrefix(r.URL.Path, "/v1/artists/"):
		id, _ := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/v1/artists/"), 10, 64)
		artist, exists := data.artists[id]
		if !exists || !data.artistVisible(id) {
			writeJSON(w, r, http.StatusNotFound, map[string]string{"error": "Artist not found"})
			return
		}
		songs := make([]map[string]any, 0)
		releases := make([]map[string]any, 0)
		for _, track := range data.Tracks {
			if data.trackVisible(track) && data.released(data.releases[track.ReleaseID]) && slices.Contains(track.ArtistIDs, id) {
				songs = append(songs, data.trackRecord(track))
			}
		}
		for _, release := range data.Releases {
			if data.releaseVisible(release) && slices.Contains(release.ArtistIDs, id) {
				releases = append(releases, data.releaseRecord(release))
			}
		}
		writeJSON(w, r, http.StatusOK, map[string]any{"artist": data.artistRecord(artist), "songs": songs, "releases": releases, "more": false, "related": []any{}, "partial": false})
	case r.URL.Path == "/v1/tracks":
		items := make([]map[string]any, 0)
		for _, track := range data.Tracks {
			if !data.trackVisible(track) || !data.released(data.releases[track.ReleaseID]) {
				continue
			}
			record := data.trackRecord(track)
			words := track.Title + " " + record["artist"].(string) + " " + record["album"].(string)
			if strings.Contains(normalized(words), query) {
				items = append(items, record)
				if len(items) == 100 {
					break
				}
			}
		}
		writeJSON(w, r, http.StatusOK, map[string]any{"data": items})
	case strings.HasPrefix(r.URL.Path, "/v1/tracks/") && strings.HasSuffix(r.URL.Path, "/lyrics"):
		id, _ := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/tracks/"), "/lyrics"), 10, 64)
		track, ok := data.tracks[id]
		if !ok || !data.trackVisible(track) || !data.released(data.releases[track.ReleaseID]) || track.LRC == "" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, r, 200, map[string]any{"syncedLyrics": track.LRC, "source": track.LyricsSource, "duration": track.Duration, "trackName": track.Title})
	case strings.HasPrefix(r.URL.Path, "/v1/releases/"):
		id, _ := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/v1/releases/"), 10, 64)
		release, exists := data.releases[id]
		if !exists || !data.releaseVisible(release) {
			writeJSON(w, r, http.StatusNotFound, map[string]string{"error": "Release not found"})
			return
		}
		writeJSON(w, r, http.StatusOK, data.releaseRecord(release))
	default:
		writeJSON(w, r, http.StatusNotFound, map[string]string{"error": "Not found"})
	}
}

func (store *Store) audio(w http.ResponseWriter, r *http.Request) {
	data, err := store.load()
	if err != nil || !data.mediaAllowed(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	name, err := mediaName(r.URL.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	mime := map[string]string{".flac": "audio/flac", ".mp3": "audio/mpeg", ".aac": "audio/aac", ".m4a": "audio/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif"}[strings.ToLower(filepath.Ext(name))]
	if mime == "" {
		http.NotFound(w, r)
		return
	}
	if value := r.Header.Get("Range"); len(value) > 128 || strings.Contains(value, ",") {
		http.Error(w, "One byte range per request", http.StatusRequestedRangeNotSatisfiable)
		return
	}
	file, err := store.media.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("ETag", fmt.Sprintf(`"%x-%x"`, stat.Size(), stat.ModTime().UnixNano()))
	http.ServeContent(w, r, filepath.Base(name), stat.ModTime(), file)
}

func (store *Store) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type, Authorization")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/distributor/") {
		store.distribution(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD, OPTIONS")
		writeJSON(w, r, http.StatusMethodNotAllowed, map[string]string{"error": "Read-only API"})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/media/") {
		store.audio(w, r)
	} else {
		store.api(w, r)
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func run() error {
	media, err := os.OpenRoot(env("LOUD_MEDIA", "/srv/loud/media"))
	if err != nil {
		return err
	}
	defer media.Close()
	store := &Store{file: env("LOUD_CATALOG", "/srv/loud/data/catalog.json"), media: media, uploads: make(chan struct{}, 2)}
	if len(os.Args) > 1 {
		if os.Args[1] == "distributor-create" {
			if len(os.Args) != 4 {
				return errors.New("usage: loud-catalog distributor-create NAME TOKEN_FILE")
			}
			return store.createDistributor(os.Args[2], os.Args[3])
		}
		if len(os.Args) != 3 || (os.Args[1] != "check" && os.Args[1] != "publish") {
			return errors.New("usage: loud-catalog [check|publish catalog.json]")
		}
		data, err := decodeCatalog(os.Args[2], store)
		if err != nil {
			return err
		}
		if os.Args[1] == "publish" {
			body, err := json.MarshalIndent(data, "", "  ")
			if err != nil {
				return err
			}
			file, err := os.CreateTemp(filepath.Dir(store.file), ".catalog-*.json")
			if err != nil {
				return err
			}
			name := file.Name()
			defer os.Remove(name)
			if err = file.Chmod(0640); err == nil {
				_, err = file.Write(body)
			}
			if err == nil {
				err = file.Sync()
			}
			closeErr := file.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
			if err := os.Rename(name, store.file); err != nil {
				return err
			}
		}
		fmt.Printf("Catalog valid: %d artists, %d releases, %d tracks\n", len(data.Artists), len(data.Releases), len(data.Tracks))
		return nil
	}
	if _, err := store.load(); err != nil {
		return err
	}
	server := &http.Server{Addr: env("LOUD_LISTEN", "127.0.0.1:8780"), Handler: http.HandlerFunc(store.serve), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	if certFile := os.Getenv("LOUD_TLS_CERT"); certFile != "" {
		getter := certificateGetter(certFile, os.Getenv("LOUD_TLS_KEY"))
		if _, err := getter(nil); err != nil {
			return err
		}
		if domainCert := os.Getenv("LOUD_TLS_DOMAIN_CERT"); domainCert != "" {
			domainGetter := certificateGetter(domainCert, os.Getenv("LOUD_TLS_DOMAIN_KEY"))
			if _, err := domainGetter(nil); err != nil {
				return err
			}
			fallback := getter
			apiURL, _ := url.Parse(origin)
			getter = func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
				if hello != nil && strings.EqualFold(strings.TrimSuffix(hello.ServerName, "."), apiURL.Hostname()) {
					return domainGetter(hello)
				}
				return fallback(hello)
			}
		}
		server.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: getter}
		challenges, err := os.OpenRoot(env("LOUD_ACME_ROOT", "/srv/loud/acme"))
		if err != nil {
			return err
		}
		defer challenges.Close()
		httpServer := &http.Server{Addr: env("LOUD_HTTP_LISTEN", ":80"), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
		httpServer.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			prefix := "/.well-known/acme-challenge/"
			if strings.HasPrefix(r.URL.Path, prefix) {
				token := strings.TrimPrefix(r.URL.Path, prefix)
				if token == "" || strings.ContainsAny(token, "/\\.%") || len(token) > 200 || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
					http.NotFound(w, r)
					return
				}
				file, err := challenges.Open(".well-known/acme-challenge/" + token)
				if err != nil {
					http.NotFound(w, r)
					return
				}
				defer file.Close()
				stat, err := file.Stat()
				if err != nil || !stat.Mode().IsRegular() || stat.Size() > 4096 {
					http.NotFound(w, r)
					return
				}
				http.ServeContent(w, r, token, stat.ModTime(), file)
				return
			}
			http.Redirect(w, r, origin+r.URL.RequestURI(), http.StatusPermanentRedirect)
		})
		errors := make(chan error, 2)
		go func() { errors <- httpServer.ListenAndServe() }()
		go func() { errors <- server.ListenAndServeTLS("", "") }()
		log.Printf("LOUD HTTPS catalog listening on %s", server.Addr)
		return <-errors
	}
	log.Printf("LOUD catalog listening on %s", server.Addr)
	return server.ListenAndServe()
}

func certificateGetter(certFile, keyFile string) func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	var mutex sync.Mutex
	var certificate *tls.Certificate
	var stamp time.Time
	return func(_ *tls.ClientHelloInfo) (*tls.Certificate, error) {
		mutex.Lock()
		defer mutex.Unlock()
		stat, err := os.Stat(certFile)
		if err != nil {
			return nil, err
		}
		if certificate == nil || stat.ModTime() != stamp {
			pair, err := tls.LoadX509KeyPair(certFile, keyFile)
			if err != nil {
				if certificate != nil {
					return certificate, nil
				}
				return nil, err
			}
			certificate, stamp = &pair, stat.ModTime()
		}
		return certificate, nil
	}
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
