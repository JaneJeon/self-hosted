# WhatsApp state recovery and migration rollback

Never run the Mac and Railway instances of the paired WhatsApp device at the
same time. Never replace databases while Go or the backup loop is running.
Removing `.migration-ready` does not stop an already-running process.

## Inspect a backup without changing production

Load backup credentials with `swarp secrets refresh` and `direnv exec
services/whatsapp-mcp <command>`. Run restic in the service image, passing
credentials by environment names rather than shell interpolation. Keep restored
data private: it contains the paired device, message history, and media.

1. List snapshots and choose a successful snapshot tagged `whatsapp-mcp`.
2. Restore into a new temporary directory. The snapshot's data root is
   `tmp/whatsapp-backup/whatsapp-mcp`, containing `storages` and `statics`.
3. Run `PRAGMA quick_check` against both `storages/whatsapp.db` and
   `storages/chatstorage.db`. Both must return `ok`.
4. Verify expected tables, message/history availability, and media. Compare
   file hashes with the preserved export when testing migration coverage.

A Kuma heartbeat proves that a job reported success. The restic snapshot and
the temporary restore establish that data can actually be recovered.

## Restore the Railway service

1. Pause the backup monitor during planned maintenance. Preserve the current
   volume and take a current backup before replacing anything when possible.
2. Through a tested GitOps commit, temporarily make the WhatsApp entrypoint
   wait before starting either Go or the backup loop. Push and verify the new
   waiting container has no Go, backup, or restic process. Deployment SUCCESS
   alone does not establish this.
3. Upload the already-validated restore archive to the volume. Confirm its
   SHA-256 locally and remotely. Preserve the existing `storages` and `statics`
   under a dated recovery directory before installing the restored directories.
   Do not merge old database WAL/SHM files with restored SQLite copies.
4. Validate both installed databases again. Clear the restored backup success
   timestamp so the next loop performs a new backup. Ensure `.migration-ready`
   exists only after the complete validated state is installed.
5. Revert the temporary waiting change through Git push. Verify WhatsApp is
   connected and logged in through the native MCP client, and verify a real
   backup, retention, and Kuma response. Resume the monitor and verify its
   recorded heartbeat. Retain the previous state until recovery is confirmed.

## Return messaging to the Mac

1. Put each remote messaging backend into verified standby through GitOps
   before enabling its Mac launcher. Keep OAuth/client configuration backups.
2. For WhatsApp, make and validate a final remote backup first. Install its
   complete state into the stopped Mac copy after preserving the old Mac state.
   The pre-cutover Mac copy lacks changes received after migration.
3. Restore only the Telegram and WhatsApp entries from the saved desktop
   configurations. Preserve unrelated entries. Disable the corresponding
   remote connectors, then start one local process for each service.
4. Verify the same account and WhatsApp connected/logged-in status through
   read-only calls. Do not delete Railway volumes or backups during rollback.

The original cutover tar, desktop configuration backups, snapshot IDs, and
verification evidence are recorded in the Craft migration workspace and the
Library/Systems WhatsApp page. Those records own dated operational state.
