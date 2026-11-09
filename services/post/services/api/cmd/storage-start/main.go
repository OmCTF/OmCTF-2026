package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"syscall"

	"svyaz.local/foundation/services/api/internal/config"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "storage configuration invalid")
		os.Exit(1)
	}
}
func run() error {
	if err := config.ValidateSecrets("S3_ROOT_PASSWORD", "S3_MEDIA_PASSWORD"); err != nil {
		return err
	}
	bucket := config.Env("S3_BUCKET", "svyaz")
	root := config.Env("S3_ROOT_USER", "local-svyaz")
	media := config.Env("S3_MEDIA_USER", "local-svyaz-media")
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`).MatchString(bucket) || root == media || os.Getenv("S3_ROOT_PASSWORD") == os.Getenv("S3_MEDIA_PASSWORD") {
		return fmt.Errorf("invalid storage identity or bucket")
	}
	identity := func(name, password string, actions []string) any {
		return map[string]any{"name": name, "credentials": []any{map[string]string{"accessKey": name, "secretKey": password}}, "actions": actions}
	}
	data, err := json.Marshal(map[string]any{"identities": []any{
		identity(root, os.Getenv("S3_ROOT_PASSWORD"), []string{"Admin", "Read", "Write", "List", "Tagging"}),
		identity(media, os.Getenv("S3_MEDIA_PASSWORD"), []string{"Read:" + bucket, "Write:" + bucket}),
	}})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp("/tmp", "s3-credentials-*.json")
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	for _, key := range []string{"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_ROOT_PASSWORD", "S3_MEDIA_PASSWORD"} {
		_ = os.Unsetenv(key)
	}
	args := []string{"weed", "mini", "-dir=/data", "-ip=s3", "-ip.bind=0.0.0.0", "-webdav=false", "-admin.ui=false", "-master.telemetry=false", "-s3.config=" + file.Name(), "-s3.iam=false", "-s3.autoCreateBucket=false", "-s3.port.iceberg=0", "-s3.port.lance=0"}
	return syscall.Exec("/usr/bin/weed", args, os.Environ())
}
