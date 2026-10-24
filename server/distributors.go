package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type Distributor struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Credential struct {
	DistributorID int64  `json:"distributorId"`
	Hash          string `json:"sha256"`
}

func authFile() string { return env("LOUD_DISTRIBUTOR_AUTH", "/etc/loud-catalog/distributors.json") }

func readJSONFile(file string, value any, limit int64) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	if stat.Size() > limit {
		return errors.New("document too large")
	}
	return json.NewDecoder(f).Decode(value)
}

func atomicJSON(file string, value any, mode os.FileMode) error {
	temporary, err := os.CreateTemp(filepath.Dir(file), ".loud-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	err = temporary.Chmod(mode)
	if err == nil {
		err = json.NewEncoder(temporary).Encode(value)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if err == nil {
		stat, statErr := temporary.Stat()
		if statErr != nil {
			err = statErr
		} else if stat.Size() > maxCatalogBytes {
			err = errors.New("document exceeds storage limit")
		}
	}
	closeErr := temporary.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(temporary.Name(), file)
}

func (store *Store) checkCatalog(data *Catalog) error {
	temporary, err := os.CreateTemp(filepath.Dir(store.file), ".validate-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	err = json.NewEncoder(temporary).Encode(data)
	closeErr := temporary.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if _, err := decodeCatalog(temporary.Name(), store); err != nil {
		return err
	}
	return nil
}

func (store *Store) saveCatalog(data *Catalog) error {
	if err := store.checkCatalog(data); err != nil {
		return err
	}
	if err := atomicJSON(store.file, data, 0640); err != nil {
		return err
	}
	store.current = nil
	return nil
}

func (store *Store) createDistributor(name, tokenFile string) error {
	if !validText(name, 160) {
		return errors.New("invalid distributor name")
	}
	data, err := decodeCatalog(store.file, store)
	if err != nil {
		return err
	}
	credentials := []Credential{}
	if err := readJSONFile(authFile(), &credentials, 65536); err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, distributor := range data.Distributors {
		if strings.EqualFold(distributor.Name, name) {
			token, err := os.ReadFile(tokenFile)
			if err != nil {
				return errors.New("distributor exists; refusing to replace credentials")
			}
			hash := sha256.Sum256([]byte(strings.TrimSpace(string(token))))
			for _, credential := range credentials {
				if credential.DistributorID == distributor.ID && credential.Hash == hex.EncodeToString(hash[:]) {
					fmt.Printf("Distributor already registered: %s (ID %d); existing key kept\n", distributor.Name, distributor.ID)
					return nil
				}
			}
			return errors.New("existing distributor credentials do not match")
		}
	}
	id := int64(1)
	for _, distributor := range data.Distributors {
		if distributor.ID >= id {
			id = distributor.ID + 1
		}
	}
	if !positiveID(id) {
		return errors.New("distributor IDs exhausted")
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	token := "loud_d_" + base64.RawURLEncoding.EncodeToString(random)
	file, err := os.OpenFile(tokenFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = file.WriteString(token + "\n")
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	hash := sha256.Sum256([]byte(token))
	credentials = append(credentials, Credential{DistributorID: id, Hash: hex.EncodeToString(hash[:])})
	if err := atomicJSON(authFile(), credentials, 0640); err != nil {
		return err
	}
	data.Distributors = append(data.Distributors, Distributor{ID: id, Name: name})
	if err := store.saveCatalog(data); err != nil {
		return err
	}
	fmt.Printf("Distributor registered: %s (ID %d). Key saved in protected server storage.\n", name, id)
	return nil
}

func (store *Store) authorize(r *http.Request) (int64, bool) {
	if r.TLS == nil {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return 0, false
		}
	}
	value := r.Header.Get("Authorization")
	scheme, token, found := strings.Cut(value, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || !strings.HasPrefix(token, "loud_d_") || len(value) > 128 {
		return 0, false
	}
	hash := sha256.Sum256([]byte(token))
	credentials := []Credential{}
	if readJSONFile(authFile(), &credentials, 65536) != nil {
		return 0, false
	}
	for _, credential := range credentials {
		stored, err := hex.DecodeString(credential.Hash)
		if err == nil && subtle.ConstantTimeCompare(stored, hash[:]) == 1 {
			return credential.DistributorID, true
		}
	}
	return 0, false
}
