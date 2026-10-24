package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Draft struct {
	DistributorID int64   `json:"distributorId"`
	Release       Release `json:"release"`
	Tracks        []Track `json:"tracks"`
}

type TrackSubmission struct {
	Title           string  `json:"title"`
	ArtistIDs       []int64 `json:"artistIds"`
	Audio           string  `json:"audio"`
	DownloadAllowed *bool   `json:"downloadAllowed,omitempty"`
	DiscNumber      int     `json:"discNumber,omitempty"`
}

type ReleaseSubmission struct {
	PublishAt   string            `json:"publishAt,omitempty"`
	Presave     bool              `json:"presave,omitempty"`
	Visibility  string            `json:"visibility,omitempty"`
	Title       string            `json:"title"`
	ArtistIDs   []int64           `json:"artistIds"`
	Cover       string            `json:"cover"`
	ReleaseDate string            `json:"release_date"`
	RecordType  string            `json:"record_type"`
	Tracks      []TrackSubmission `json:"tracks"`
}

func decodeSubmission(w http.ResponseWriter, r *http.Request, value any) error {
	if strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]) != "application/json" {
		return errors.New("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return errors.New("invalid JSON submission")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("only one JSON document is allowed")
	}
	return nil
}

func (store *Store) draftsFile() string {
	return filepath.Join(filepath.Dir(store.file), "drafts.json")
}

func (store *Store) drafts() ([]Draft, error) {
	items := []Draft{}
	err := readJSONFile(store.draftsFile(), &items, maxCatalogBytes)
	if os.IsNotExist(err) {
		return items, nil
	}
	return items, err
}

func addDraft(data *Catalog, draft Draft) {
	data.Releases = append(data.Releases, draft.Release)
	data.releases[draft.Release.ID] = draft.Release
	data.Tracks = append(data.Tracks, draft.Tracks...)
	for _, track := range draft.Tracks {
		data.tracks[track.ID] = track
	}
}

func (store *Store) upsertArtist(w http.ResponseWriter, r *http.Request, distributorID int64) {
	var artist Artist
	if err := decodeSubmission(w, r, &artist); err != nil {
		writeJSON(w, r, 400, map[string]string{"error": err.Error()})
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	data, err := decodeCatalog(store.file, store)
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
		return
	}
	if data.distributors[distributorID].ID == 0 {
		writeJSON(w, r, 401, map[string]string{"error": "Distributor not registered"})
		return
	}
	code := 201
	index := -1
	if artist.ID != 0 {
		if existing := data.artists[artist.ID]; existing.ID == 0 || existing.DistributorID != distributorID {
			writeJSON(w, r, 404, map[string]string{"error": "Artist not found"})
			return
		}
		for i, item := range data.Artists {
			if item.ID == artist.ID {
				index = i
				break
			}
		}
		code = 200
	} else {
		artist.ID = 1
		for _, item := range data.Artists {
			if item.ID >= artist.ID {
				artist.ID = item.ID + 1
			}
		}
	}
	artist.DistributorID = distributorID
	for _, name := range []string{artist.Picture, artist.Banner} {
		if name == "" {
			continue
		}
		file, err := store.ownedFile(name, distributorID)
		if err != nil {
			writeJSON(w, r, 422, map[string]string{"error": "Artwork must be uploaded by this distributor"})
			return
		}
		err = pictureInfo(file)
		file.Close()
		if err != nil {
			writeJSON(w, r, 422, map[string]string{"error": err.Error()})
			return
		}
	}
	if index >= 0 {
		data.Artists[index] = artist
	} else {
		data.Artists = append(data.Artists, artist)
	}
	if err := store.saveCatalog(data); err != nil {
		writeJSON(w, r, 422, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, r, code, map[string]any{"artist": data.artistRecord(artist)})
}

func (store *Store) createDraft(w http.ResponseWriter, r *http.Request, distributorID int64) {
	var input ReleaseSubmission
	if err := decodeSubmission(w, r, &input); err != nil {
		writeJSON(w, r, 400, map[string]string{"error": err.Error()})
		return
	}
	if len(input.Tracks) == 0 || len(input.Tracks) > 200 {
		writeJSON(w, r, 422, map[string]string{"error": "A release must contain 1 to 200 tracks"})
		return
	}
	input.PublishAt = publicationTime(input.ReleaseDate, input.PublishAt)
	store.mu.Lock()
	defer store.mu.Unlock()
	data, err := decodeCatalog(store.file, store)
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
		return
	}
	if len(input.ArtistIDs) == 0 || data.artists[input.ArtistIDs[0]].DistributorID != distributorID {
		writeJSON(w, r, 403, map[string]string{"error": "Lead artist must belong to this distributor"})
		return
	}
	cover, err := store.ownedFile(input.Cover, distributorID)
	if err != nil {
		writeJSON(w, r, 422, map[string]string{"error": "Upload release artwork first"})
		return
	}
	err = pictureInfo(cover)
	cover.Close()
	if err != nil {
		writeJSON(w, r, 422, map[string]string{"error": err.Error()})
		return
	}
	drafts, err := store.drafts()
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Draft storage unavailable"})
		return
	}
	if len(drafts) >= 2000 {
		writeJSON(w, r, 409, map[string]string{"error": "Draft limit reached"})
		return
	}
	releaseID, trackID := int64(1), int64(1)
	for _, release := range data.Releases {
		if release.ID >= releaseID {
			releaseID = release.ID + 1
		}
	}
	for _, track := range data.Tracks {
		if track.ID >= trackID {
			trackID = track.ID + 1
		}
	}
	for _, draft := range drafts {
		if draft.Release.ID >= releaseID {
			releaseID = draft.Release.ID + 1
		}
		for _, track := range draft.Tracks {
			if track.ID >= trackID {
				trackID = track.ID + 1
			}
		}
	}
	draft := Draft{DistributorID: distributorID, Release: Release{ID: releaseID, DistributorID: distributorID, Title: input.Title, ArtistIDs: input.ArtistIDs, TrackIDs: []int64{}, Cover: input.Cover, ReleaseDate: input.ReleaseDate, RecordType: input.RecordType, PublishAt: input.PublishAt, Presave: input.Presave, Visibility: input.Visibility}, Tracks: []Track{}}
	for _, submitted := range input.Tracks {
		file, err := store.ownedFile(submitted.Audio, distributorID)
		if err != nil {
			writeJSON(w, r, 422, map[string]string{"error": "Upload each FLAC master first"})
			return
		}
		info, err := flacInfo(file)
		file.Close()
		if err != nil {
			writeJSON(w, r, 422, map[string]string{"error": err.Error()})
			return
		}
		artists := submitted.ArtistIDs
		if len(artists) == 0 {
			artists = input.ArtistIDs
		}
		if submitted.DiscNumber < 0 {
			writeJSON(w, r, 422, map[string]string{"error": "Invalid disc number"})
			return
		}
		draft.Tracks = append(draft.Tracks, Track{ID: trackID, Title: submitted.Title, ArtistIDs: artists, ReleaseID: releaseID, Duration: info.Duration, Audio: submitted.Audio, Format: info.Format, SampleRate: info.SampleRate, BitDepth: info.BitDepth, DiscNumber: submitted.DiscNumber, DownloadAllowed: submitted.DownloadAllowed})
		draft.Release.TrackIDs = append(draft.Release.TrackIDs, trackID)
		trackID++
	}
	addDraft(data, draft)
	if err := store.checkCatalog(data); err != nil {
		writeJSON(w, r, 422, map[string]string{"error": err.Error()})
		return
	}
	drafts = append(drafts, draft)
	if err := atomicJSON(store.draftsFile(), drafts, 0640); err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Unable to save draft"})
		return
	}
	writeJSON(w, r, 201, map[string]any{"id": releaseID, "status": "draft", "release": data.releaseRecord(draft.Release)})
}

func (store *Store) publishDraft(w http.ResponseWriter, r *http.Request, distributorID, id int64) {
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
	for _, draft := range drafts {
		if draft.Release.ID != id || draft.DistributorID != distributorID {
			continue
		}
		if existing, ok := data.releases[id]; ok {
			if existing.DistributorID != distributorID {
				writeJSON(w, r, 409, map[string]string{"error": "Release ID conflict"})
				return
			}
			writeJSON(w, r, 200, map[string]any{"id": id, "status": "published", "release": data.releaseRecord(existing)})
			return
		}
		addDraft(data, draft)
		if err := store.saveCatalog(data); err != nil {
			writeJSON(w, r, 422, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, r, 200, map[string]any{"id": id, "status": "published", "release": data.releaseRecord(draft.Release)})
		return
	}
	writeJSON(w, r, 404, map[string]string{"error": "Draft not found"})
}

func (store *Store) distribution(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	distributorID, ok := store.authorize(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeJSON(w, r, 401, map[string]string{"error": "Valid distributor API key required"})
		return
	}
	registered, err := store.load()
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
		return
	}
	if registered.distributors[distributorID].ID == 0 {
		writeJSON(w, r, 401, map[string]string{"error": "Distributor not registered"})
		return
	}
	if store.manage(w, r, distributorID) {
		return
	}
	if r.Method == http.MethodPost {
		switch r.URL.Path {
		case "/v1/distributor/artists":
			store.upsertArtist(w, r, distributorID)
			return
		case "/v1/distributor/uploads":
			store.upload(w, r, distributorID)
			return
		case "/v1/distributor/releases":
			store.createDraft(w, r, distributorID)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/v1/distributor/releases/") && strings.HasSuffix(r.URL.Path, "/publish") {
			value := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/distributor/releases/"), "/publish")
			id, err := strconv.ParseInt(value, 10, 64)
			if err == nil && positiveID(id) {
				store.publishDraft(w, r, distributorID, id)
				return
			}
		}
	} else if r.Method == http.MethodGet {
		data, err := store.load()
		if err != nil {
			writeJSON(w, r, 503, map[string]string{"error": "Catalog unavailable"})
			return
		}
		if r.URL.Path == "/v1/distributor/me" {
			writeJSON(w, r, 200, data.distributors[distributorID])
			return
		}
		if r.URL.Path == "/v1/distributor/artists" {
			items := []map[string]any{}
			for _, artist := range data.Artists {
				if artist.DistributorID == distributorID {
					items = append(items, data.artistRecord(artist))
				}
			}
			writeJSON(w, r, 200, map[string]any{"data": items})
			return
		}
		if r.URL.Path == "/v1/distributor/releases" {
			store.mu.Lock()
			drafts, err := store.drafts()
			store.mu.Unlock()
			if err != nil {
				writeJSON(w, r, 503, map[string]string{"error": "Draft storage unavailable"})
				return
			}
			items := []map[string]any{}
			for _, draft := range drafts {
				if draft.DistributorID == distributorID {
					status := "draft"
					if data.releases[draft.Release.ID].ID != 0 {
						status = "published"
					}
					items = append(items, map[string]any{"id": draft.Release.ID, "title": draft.Release.Title, "status": status})
				}
			}
			writeJSON(w, r, 200, map[string]any{"data": items})
			return
		}
	} else {
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, r, 405, map[string]string{"error": "Unsupported method"})
		return
	}
	writeJSON(w, r, 404, map[string]string{"error": "Unknown distributor endpoint"})
}
