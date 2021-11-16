Spark (for now) only supports the "cloud" storages: https://sparkmailapp.com/features/services

- Dropbox
- Box
- iCloud Drive
- OneDrive
- Google Drive

Obviously, I'm not going to be sending any large files that _necessitate_ the use of a storage layer; however, I could use the storage layer as the "source of truth" for all documents (so I don't have 5 copies of the same document lying around in email, filesystem, etc) and control access to it (e.g. make it unlisted, then private after the email has been received).

I do really need a synced, "base" storage layer for:

- syncing ~/Desktop + ~/Documents (which is where all of the ACTUAL documents are stored - notes, word/excel, all of the legal shit, screenshots, etc)
- storing multimedia files (even if the storage layer doesn't do viewing well by itself; it just needs to store and sync it, deletions and all)

If it's just app data + message attachments + phone backups + calendar/contacts, it should easily fit within the 5GB limit for free iCloud.

As for "interfaces" to the storage, for photos there's either the native dropbox photo sync or photoprism; for files, there's the native dropbox document scanner or Readdle's own app.

If possible I think it'd be best to rely on my own self-hosted storage setup (even if it is using a cloud storage such as B2 in the backend), purely because Dropbox and iCloud can close my accounts at any time; whereas with Nextcloud I have the control.

## Photos

Just sharing "regular" files should be an easy task (famous last words). However,
