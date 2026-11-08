// Shared by SyncNotice (server) and its dismiss button (client); kept out of "use client" files
// so the server reads the real string, not a client reference.

/** Cookie holding the key of the sync problem the user dismissed. */
export const SYNC_NOTICE_COOKIE = "mp_sync_notice";
