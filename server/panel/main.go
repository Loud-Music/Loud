package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func main() {
	executable, _ := os.Executable()
	assets := flag.String("assets", filepath.Join(filepath.Dir(executable), "web"), "UI directory")
	keyFile := flag.String("key", filepath.Join(filepath.Dir(executable), "api-key.txt"), "Distributor credential file")
	listen := flag.String("listen", "127.0.0.1:17420", "Local loopback address")
	open := flag.Bool("open", true, "Open local panel")
	defaultConnection := filepath.Join(filepath.Dir(executable), "connection.private.json")
	if _, err := os.Stat(defaultConnection); err != nil {
		defaultConnection = ""
	}
	connectConfig := flag.String("connect-config", defaultConnection, "Optional private origin connection file")
	flag.Parse()
	if !strings.HasPrefix(*listen, "127.0.0.1:") {
		log.Fatal("Panel must listen on IPv4 loopback")
	}
	key, err := os.ReadFile(*keyFile)
	if err != nil || !strings.HasPrefix(strings.TrimSpace(string(key)), "loud_d_") {
		log.Fatal("Не удалось прочитать файл ключа CLOUDED.D")
	}
	token := strings.TrimSpace(string(key))
	base := "http://" + *listen
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 25 * time.Second, MaxIdleConnsPerHost: 4}
	if *connectConfig != "" {
		var config struct {
			Host string `json:"host"`
		}
		body, err := os.ReadFile(*connectConfig)
		if err != nil || json.Unmarshal(body, &config) != nil || net.ParseIP(config.Host) == nil {
			log.Fatal("Некорректный локальный файл соединения")
		}
		transport.Proxy = nil
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.Host}
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			if address != "api.mambo.wtf:443" {
				return nil, fmt.Errorf("Unsupported API host")
			}
			return (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext(ctx, network, net.JoinHostPort(config.Host, "443"))
		}
	}
	client := &http.Client{Timeout: 5 * time.Minute, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	files := http.FileServer(http.Dir(*assets))
	writeError := func(w http.ResponseWriter, code int, message string) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]string{"error": message})
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if r.Host != *listen || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != base) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeError(w, 403, "Доступ только с локальной панели")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			part := strings.TrimPrefix(r.URL.Path, "/api/")
			if strings.Contains(part, "..") || strings.ContainsAny(part, "%\\") {
				http.NotFound(w, r)
				return
			}
			preview := part == "media" && (r.Method == "GET" || r.Method == "HEAD")
			if !preview && r.Header.Get("X-Loud-Panel") != "1" {
				writeError(w, 403, "Недопустимый запрос")
				return
			}
			target := url.URL{Scheme: "https", Host: "api.mambo.wtf", Path: "/v1/distributor/" + part, RawQuery: r.URL.RawQuery}
			body := http.MaxBytesReader(w, r.Body, 201<<20)
			request, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), body)
			if err != nil {
				writeError(w, 400, "Некорректный запрос")
				return
			}
			request.ContentLength = r.ContentLength
			request.Header.Set("Authorization", "Bearer "+token)
			request.Header.Set("Content-Type", r.Header.Get("Content-Type"))
			if r.Header.Get("Range") != "" {
				request.Header.Set("Range", r.Header.Get("Range"))
			}
			response, err := client.Do(request)
			if err != nil {
				writeError(w, 502, "Не удалось соединиться с API. Попробуйте ещё раз.")
				return
			}
			defer response.Body.Close()
			if response.StatusCode == 502 || response.StatusCode == 503 || response.StatusCode == 504 {
				writeError(w, response.StatusCode, "API временно недоступен. Введённые данные остались в форме.")
				return
			}
			for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
				if value := response.Header.Get(name); value != "" {
					w.Header().Set(name, value)
				}
			}
			w.WriteHeader(response.StatusCode)
			io.Copy(w, response.Body)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(*assets, "distributor.html"))
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/assets/") && r.URL.Path != "/loud-logo.svg" && r.URL.Path != "/loud-artist-badge.svg" {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: *listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	openWindow := func() {
		var command *exec.Cmd
		switch runtime.GOOS {
		case "windows":
			edge := filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe")
			if _, err := os.Stat(edge); err == nil {
				command = exec.Command(edge, "--app="+base, "--no-first-run")
			} else {
				command = exec.Command("rundll32", "url.dll,FileProtocolHandler", base)
			}
		case "darwin":
			command = exec.Command("open", base)
		default:
			command = exec.Command("xdg-open", base)
		}
		command.Start()
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		if *open {
			openWindow()
			return
		}
		log.Fatal("Локальный порт панели уже занят")
	}
	if *open {
		go func() {
			time.Sleep(500 * time.Millisecond)
			openWindow()
		}()
	}
	fmt.Println("Панель CLOUDED.D: " + base)
	log.Fatal(server.Serve(listener))
}
