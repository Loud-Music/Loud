package main

import (
	"errors"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

type TrackEdit struct {
	Title        *string  `json:"title"`
	ArtistIDs    *[]int64 `json:"artistIds"`
	Audio        *string  `json:"audio"`
	Cover        *string  `json:"cover"`
	Visibility   *string  `json:"visibility"`
	Banned       *bool    `json:"banned"`
	LRC          *string  `json:"lrc"`
	LyricsSource *string  `json:"lyricsSource"`
}

type ReleaseEdit struct {
	Title       *string  `json:"title"`
	Cover       *string  `json:"cover"`
	ArtistIDs   *[]int64 `json:"artistIds"`
	TrackIDs    *[]int64 `json:"trackIds"`
	ReleaseDate *string  `json:"release_date"`
	PublishAt   *string  `json:"publishAt"`
	RecordType  *string  `json:"record_type"`
	Visibility  *string  `json:"visibility"`
	Presave     *bool    `json:"presave"`
}

func (store *Store) artworkOwned(name string, owner int64) error {
	file, err := store.ownedFile(name, owner)
	if err != nil {
		return errors.New("Artwork must belong to this distributor")
	}
	defer file.Close()
	return pictureInfo(file)
}

func (store *Store) editTrack(track *Track, edit TrackEdit, owner int64) error {
	if edit.Title != nil {
		track.Title = *edit.Title
	}
	if edit.ArtistIDs != nil {
		track.ArtistIDs = *edit.ArtistIDs
	}
	if edit.Visibility != nil {
		track.Visibility = *edit.Visibility
	}
	if edit.Banned != nil {
		track.Banned = *edit.Banned
	}
	if edit.LRC != nil {
		track.LRC = *edit.LRC
		track.LyricsSource = "uploaded"
		if track.LRC == "" {
			track.LyricsSource = ""
		}
	}
	if edit.LyricsSource != nil && track.LRC != "" {
		track.LyricsSource = *edit.LyricsSource
	}
	if edit.Cover != nil {
		if *edit.Cover != "" {
			if err := store.artworkOwned(*edit.Cover, owner); err != nil {
				return err
			}
		}
		track.Cover = *edit.Cover
	}
	if edit.Audio != nil {
		file, err := store.ownedFile(*edit.Audio, owner)
		if err != nil {
			return errors.New("Upload the replacement FLAC first")
		}
		info, err := flacInfo(file)
		file.Close()
		if err != nil {
			return err
		}
		track.Audio, track.Duration, track.Format, track.SampleRate, track.BitDepth = *edit.Audio, info.Duration, info.Format, info.SampleRate, info.BitDepth
	}
	return validateLRC(track.LRC, track.Duration)
}

func (store *Store) editRelease(release *Release, edit ReleaseEdit, owner int64, data *Catalog) error {
	if edit.Title != nil {
		release.Title = *edit.Title
	}
	if edit.ReleaseDate != nil {
		release.ReleaseDate = *edit.ReleaseDate
		if edit.PublishAt == nil {
			release.PublishAt = publicationTime(release.ReleaseDate, "")
		}
	}
	if edit.PublishAt != nil {
		release.PublishAt = publicationTime(release.ReleaseDate, *edit.PublishAt)
	}
	if edit.Presave != nil {
		release.Presave = *edit.Presave
	}
	if edit.Visibility != nil {
		release.Visibility = *edit.Visibility
	}
	if edit.RecordType != nil {
		release.RecordType = *edit.RecordType
	}
	if edit.ArtistIDs != nil {
		release.ArtistIDs = *edit.ArtistIDs
	}
	if len(release.ArtistIDs) == 0 || data.artists[release.ArtistIDs[0]].DistributorID != owner {
		return errors.New("Lead artist must belong to this distributor")
	}
	if edit.TrackIDs != nil {
		before, after := slices.Clone(release.TrackIDs), slices.Clone(*edit.TrackIDs)
		slices.Sort(before)
		slices.Sort(after)
		if !slices.Equal(before, after) {
			return errors.New("Track order must contain the same tracks")
		}
		release.TrackIDs = *edit.TrackIDs
	}
	if edit.Cover != nil {
		if err := store.artworkOwned(*edit.Cover, owner); err != nil {
			return err
		}
		release.Cover = *edit.Cover
	}
	return nil
}

func (store *Store) managementCatalog(w http.ResponseWriter, r *http.Request, owner int64) {
	store.mu.Lock()
	defer store.mu.Unlock()
	data, err := decodeCatalog(store.file, store)
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
		return
	}
	drafts, err := store.drafts()
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Draft storage unavailable"})
		return
	}
	artists, releases := []Artist{}, []map[string]any{}
	for _, artist := range data.Artists {
		if artist.DistributorID == owner {
			artists = append(artists, artist)
		}
	}
	add := func(release Release, tracks []Track, status string) {
		if release.DistributorID == owner {
			releases = append(releases, map[string]any{"release": release, "tracks": tracks, "status": status})
		}
	}
	for _, release := range data.Releases {
		tracks := []Track{}
		for _, id := range release.TrackIDs {
			tracks = append(tracks, data.tracks[id])
		}
		status := "published"
		if !data.released(release) {
			status = "scheduled"
		}
		add(release, tracks, status)
	}
	for _, draft := range drafts {
		if data.releases[draft.Release.ID].ID == 0 {
			add(draft.Release, draft.Tracks, "draft")
		}
	}
	writeJSON(w, r, 200, map[string]any{"artists": artists, "releases": releases, "distributor": data.distributors[owner]})
}

func (store *Store) managementEdit(w http.ResponseWriter, r *http.Request, owner, id int64, kind string) {
	var trackEdit TrackEdit
	var releaseEdit ReleaseEdit
	var input any = &trackEdit
	if kind == "releases" {
		input = &releaseEdit
	}
	if r.Method != http.MethodDelete {
		if err := decodeSubmission(w, r, input); err != nil {
			writeJSON(w, r, 400, map[string]string{"error": err.Error()})
			return
		}
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	data, err := decodeCatalog(store.file, store)
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
		return
	}
	drafts, err := store.drafts()
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Draft storage unavailable"})
		return
	}
	if kind == "artists" {
		for i, artist := range data.Artists {
			if artist.ID == id && artist.DistributorID == owner {
				data.Artists[i].Deleted = true
				if err := store.saveCatalog(data); err != nil {
					writeJSON(w, r, 422, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, r, 200, map[string]bool{"deleted": true})
				return
			}
		}
		writeJSON(w, r, 404, map[string]string{"error": "Artist not found"})
		return
	}
	published := map[int64]bool{}
	for _, release := range data.Releases {
		published[release.ID] = true
	}
	for _, draft := range drafts {
		if !published[draft.Release.ID] {
			addDraft(data, draft)
		}
	}
	found := false
	var changedRelease int64
	if kind == "tracks" {
		for i := range data.Tracks {
			track := &data.Tracks[i]
			if track.ID != id || data.releases[track.ReleaseID].DistributorID != owner {
				continue
			}
			err = store.editTrack(track, trackEdit, owner)
			changedRelease = track.ReleaseID
			found = true
			break
		}
	} else {
		for i := range data.Releases {
			release := &data.Releases[i]
			if release.ID != id || release.DistributorID != owner {
				continue
			}
			err = store.editRelease(release, releaseEdit, owner, data)
			changedRelease = release.ID
			found = true
			break
		}
	}
	if !found {
		writeJSON(w, r, 404, map[string]string{"error": "Record not found"})
		return
	}
	if err == nil {
		err = store.checkCatalog(data)
	}
	if err != nil {
		writeJSON(w, r, 422, map[string]string{"error": err.Error()})
		return
	}
	if published[changedRelease] {
		data.Releases = slices.DeleteFunc(data.Releases, func(item Release) bool { return !published[item.ID] })
		data.Tracks = slices.DeleteFunc(data.Tracks, func(item Track) bool { return !published[item.ReleaseID] })
		err = store.saveCatalog(data)
	} else {
		for i := range drafts {
			if drafts[i].Release.ID != changedRelease {
				continue
			}
			for _, release := range data.Releases {
				if release.ID == changedRelease {
					drafts[i].Release = release
					break
				}
			}
			drafts[i].Tracks = []Track{}
			for _, track := range data.Tracks {
				if track.ReleaseID == changedRelease {
					drafts[i].Tracks = append(drafts[i].Tracks, track)
				}
			}
		}
		err = atomicJSON(store.draftsFile(), drafts, 0640)
	}
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Unable to save changes"})
		return
	}
	writeJSON(w, r, 200, map[string]bool{"saved": true})
}

func (store *Store) manage(w http.ResponseWriter, r *http.Request, owner int64) bool {
	part := strings.TrimPrefix(r.URL.Path, "/v1/distributor/")
	if part == "catalog" && r.Method == http.MethodGet {
		store.managementCatalog(w, r, owner)
		return true
	}
	if part == "media" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		file, err := store.ownedFile(r.URL.Query().Get("path"), owner)
		if err != nil {
			http.NotFound(w, r)
			return true
		}
		defer file.Close()
		stat, err := file.Stat()
		if err != nil {
			http.NotFound(w, r)
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, filepath.Base(stat.Name()), stat.ModTime(), file)
		return true
	}
	parts := strings.Split(part, "/")
	if len(parts) < 2 {
		return false
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || !positiveID(id) {
		return false
	}
	if len(parts) == 4 && parts[0] == "tracks" && parts[2] == "lyrics" && parts[3] == "detect" && r.Method == http.MethodPost {
		store.detectLyrics(w, r, owner, id)
		return true
	}
	if len(parts) != 2 {
		return false
	}
	if parts[0] == "artists" && r.Method == http.MethodDelete {
		store.managementEdit(w, r, owner, id, "artists")
		return true
	}
	if (parts[0] == "tracks" || parts[0] == "releases") && r.Method == http.MethodPatch {
		store.managementEdit(w, r, owner, id, parts[0])
		return true
	}
	return false
}
