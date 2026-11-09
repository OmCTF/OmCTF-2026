package guild

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func creationReceipt(r *http.Request, tx pgx.Tx, user, kind string, payload any) (string, []byte, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		return "", nil, nil
	}
	if !validID(key) {
		return "", nil, fail(400, "invalid_idempotency_key")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", nil, err
	}
	digest := hash(string(encoded))
	var previous []byte
	var id, previousKind string
	err = tx.QueryRow(r.Context(), `SELECT kind,payload_hash,object_id::text FROM guild.creation_receipts WHERE user_id=$1 AND key=$2`, user, key).Scan(&previousKind, &previous, &id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", digest, nil
	}
	if err != nil {
		return "", nil, err
	}
	if previousKind != kind || !bytes.Equal(digest, previous) {
		return "", nil, fail(409, "idempotency_conflict")
	}
	return id, digest, nil
}

func saveCreation(r *http.Request, tx pgx.Tx, user, kind, id string, digest []byte) error {
	if digest == nil {
		return nil
	}
	_, err := tx.Exec(r.Context(), `INSERT INTO guild.creation_receipts(user_id,key,kind,payload_hash,object_id) VALUES($1,$2,$3,$4,$5)`, user, r.Header.Get("Idempotency-Key"), kind, digest, id)
	return err
}
