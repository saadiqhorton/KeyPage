# KeyPage backup procedure

KeyPage has two different safety mechanisms:

- The encrypted backup export in **Settings** is the preferred way to move
  Key Entries between vaults. Keep the Master Password separate from the file.
- `scripts/backup.sh` copies the encrypted SQLite vault data and instance
  metadata for disaster recovery. It is a host backup, not a replacement for
  the encrypted export.

## Before an upgrade

Use a destination that is not inside the KeyPage checkout. It should be an
external disk, mounted backup volume, or another host:

```bash
cd ~/keypage
bash scripts/backup.sh /mnt/off-box/keypage
```

The script briefly stops a running container so SQLite is quiescent, creates a
mode-`0600` archive, writes a SHA-256 sidecar, and starts the container again.
Copy both files to the off-box destination. On that destination, verify the
copy:

```bash
sha256sum --check keypage-data-<timestamp>.tar.gz.sha256
```

Do not put the archive in Git, paste it into chat, or store it beside the live
`./data` directory. The archive includes `setup-token` when that file still
exists.

## Restore drill

Before relying on a backup, extract it into a disposable KeyPage checkout and
run the rollback/health procedure there. Never overwrite the live `./data`
directory until the archive has passed checksum verification and the disposable
instance starts with the expected vault contents.
