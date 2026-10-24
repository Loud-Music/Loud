package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	imagepkg "image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

type AudioInfo struct {
	Duration   float64 `json:"duration"`
	Format     string  `json:"format"`
	SampleRate int     `json:"sampleRate"`
	BitDepth   int     `json:"bitDepth"`
}

func flacInfo(file *os.File) (AudioInfo, error) {
	invalid := errors.New("a complete FLAC master with STREAMINFO is required")
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return AudioInfo{}, err
	}
	header := make([]byte, 8)
	if _, err := io.ReadFull(file, header); err != nil || string(header[:4]) != "fLaC" || header[4]&0x7f != 0 || header[5] != 0 || header[6] != 0 || header[7] != 34 {
		return AudioInfo{}, invalid
	}
	info := make([]byte, 34)
	if _, err := io.ReadFull(file, info); err != nil {
		return AudioInfo{}, invalid
	}
	packed := binary.BigEndian.Uint64(info[10:18])
	rate := int(packed >> 44)
	bits := int((packed>>36)&31) + 1
	samples := packed & ((1 << 36) - 1)
	if rate < 8000 || rate > 384000 || samples == 0 || bits < 8 || bits > 32 {
		return AudioInfo{}, invalid
	}
	duration := float64(samples) / float64(rate)
	if duration > 86400 {
		return AudioInfo{}, errors.New("audio exceeds 24 hours")
	}
	last := header[4]&0x80 != 0
	metadataBytes := int64(42)
	for !last {
		block := make([]byte, 4)
		if _, err := io.ReadFull(file, block); err != nil {
			return AudioInfo{}, invalid
		}
		length := int64(block[1])<<16 | int64(block[2])<<8 | int64(block[3])
		metadataBytes += length + 4
		if metadataBytes > 16<<20 {
			return AudioInfo{}, errors.New("FLAC metadata exceeds 16 MiB")
		}
		last = block[0]&0x80 != 0
		if _, err := file.Seek(length, io.SeekCurrent); err != nil {
			return AudioInfo{}, invalid
		}
	}
	sync := make([]byte, 2)
	if _, err := io.ReadFull(file, sync); err != nil || sync[0] != 0xff || sync[1]&0xfe != 0xf8 {
		return AudioInfo{}, invalid
	}
	return AudioInfo{Duration: duration, Format: "FLAC", SampleRate: rate, BitDepth: bits}, nil
}

func (store *Store) ownedFile(name string, distributorID int64) (*os.File, error) {
	prefix := "/media/" + strconv.FormatInt(distributorID, 10) + "/"
	if !strings.HasPrefix(name, prefix) {
		return nil, errors.New("asset does not belong to this distributor")
	}
	relative, err := mediaName(name)
	if err != nil {
		return nil, err
	}
	return store.media.Open(relative)
}

func pictureInfo(file *os.File) error {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	info, _, err := imagepkg.DecodeConfig(file)
	if err != nil || info.Width < 1 || info.Height < 1 || info.Width > 12000 || info.Height > 12000 || int64(info.Width)*int64(info.Height) > 40000000 {
		return errors.New("valid JPG or PNG artwork up to 40 megapixels is required")
	}
	return nil
}

func (store *Store) upload(w http.ResponseWriter, r *http.Request, distributorID int64) {
	select {
	case store.uploads <- struct{}{}:
		defer func() { <-store.uploads }()
	default:
		writeJSON(w, r, 429, map[string]string{"error": "Upload queue busy; retry later"})
		return
	}
	ext := strings.ToLower(path.Ext(r.URL.Query().Get("filename")))
	if strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]) != "application/octet-stream" || !slices.Contains([]string{".flac", ".jpg", ".jpeg", ".png"}, ext) {
		writeJSON(w, r, 415, map[string]string{"error": "Upload a FLAC master, JPG or PNG as application/octet-stream"})
		return
	}
	limit := int64(200 << 20)
	if ext != ".flac" {
		limit = 8 << 20
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(10 * time.Minute))
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	defer r.Body.Close()
	directory := filepath.Join(env("LOUD_MEDIA", "/srv/loud/media"), strconv.FormatInt(distributorID, 10))
	if err := os.MkdirAll(directory, 0750); err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Upload storage unavailable"})
		return
	}
	file, err := os.CreateTemp(directory, ".upload-*")
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Upload storage unavailable"})
		return
	}
	defer file.Close()
	defer os.Remove(file.Name())
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, hash), r.Body)
	if err != nil {
		var max *http.MaxBytesError
		code := 400
		if errors.As(err, &max) {
			code = 413
		}
		writeJSON(w, r, code, map[string]string{"error": "Upload incomplete or exceeds size limit"})
		return
	}
	if size == 0 {
		writeJSON(w, r, 400, map[string]string{"error": "Empty file"})
		return
	}
	var audio AudioInfo
	if ext == ".flac" {
		audio, err = flacInfo(file)
	} else {
		err = pictureInfo(file)
	}
	if err != nil {
		writeJSON(w, r, 422, map[string]string{"error": err.Error()})
		return
	}
	if err = file.Sync(); err == nil {
		err = file.Chmod(0640)
	}
	if err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Unable to save asset"})
		return
	}
	if err = file.Close(); err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Unable to save asset"})
		return
	}
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Unable to allocate asset"})
		return
	}
	name := hex.EncodeToString(random) + ext
	if err = os.Rename(file.Name(), filepath.Join(directory, name)); err != nil {
		writeJSON(w, r, 503, map[string]string{"error": "Unable to save asset"})
		return
	}
	result := map[string]any{"path": fmt.Sprintf("/media/%d/%s", distributorID, name), "size": size, "sha256": hex.EncodeToString(hash.Sum(nil))}
	if ext == ".flac" {
		result["audio"] = audio
	}
	writeJSON(w, r, 201, result)
}
