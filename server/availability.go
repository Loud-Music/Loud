package main

import "time"

func publicationTime(date, configured string) string {
	if configured == "" && date > time.Now().UTC().Format(time.DateOnly) {
		return date + "T00:00:00Z"
	}
	return configured
}

func validVisibility(value string) bool { return value == "" || value == "public" || value == "hidden" }

func (data *Catalog) artistVisible(id int64) bool {
	artist, ok := data.artists[id]
	return ok && !artist.Deleted && !artist.Banned && artist.Visibility != "hidden"
}

func (data *Catalog) released(release Release) bool {
	if release.PublishAt == "" {
		return true
	}
	date, err := time.Parse(time.RFC3339, release.PublishAt)
	return err == nil && !time.Now().Before(date)
}

func (data *Catalog) releaseVisible(release Release) bool {
	if release.ID == 0 || release.Visibility == "hidden" || (!data.released(release) && !release.Presave) {
		return false
	}
	for _, id := range release.ArtistIDs {
		if !data.artistVisible(id) {
			return false
		}
	}
	return true
}

func (data *Catalog) trackVisible(track Track) bool {
	if track.ID == 0 || track.Banned || track.Visibility == "hidden" || !data.releaseVisible(data.releases[track.ReleaseID]) {
		return false
	}
	for _, id := range track.ArtistIDs {
		if !data.artistVisible(id) {
			return false
		}
	}
	return true
}

func (data *Catalog) mediaAllowed(name string) bool {
	if !data.media[name] {
		return false
	}
	for _, artist := range data.Artists {
		if (name == artist.Picture || name == artist.Banner) && data.artistVisible(artist.ID) {
			return true
		}
	}
	for _, release := range data.Releases {
		if name == release.Cover && data.releaseVisible(release) {
			return true
		}
	}
	for _, track := range data.Tracks {
		if !data.trackVisible(track) {
			continue
		}
		if name == track.Cover {
			return true
		}
		if name == track.Audio && data.released(data.releases[track.ReleaseID]) {
			return true
		}
	}
	return false
}
