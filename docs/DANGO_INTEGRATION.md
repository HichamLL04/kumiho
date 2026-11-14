# Dango reading sync

Kumiho can send a completed manga chapter to a personal Dango account. Each Kumiho user configures a Dango endpoint and personal API key under **Settings → Dango Sync**. The key is encrypted with Kumiho's plugin-secret key and is never returned by the settings API.

The Dango key identifies the receiving Dango account. Kumiho's internal user ID is used only to load that user's saved endpoint and key; it is not sent as an account selector. Other Kumiho users therefore need their own Dango API key to sync into their own account.

The default endpoint is `http://192.168.1.99:8787/api/v1/webhook/reading`; change it to the address reachable from the Kumiho server. A key can be created in Dango under **Connections → Reading API**. Save a blank key field to keep the existing key, or choose **Remove key** to revoke the saved connection.

When a chapter is newly marked complete, Kumiho sends Dango a request equivalent to:

```json
{
  "title": "Series title",
  "media_type": "manga",
  "chapter": 12,
  "volume": 1,
  "identifiers": {
    "anilist_id": "210331",
    "mal_id": "196051"
  }
}
```

`volume` and `identifiers` are optional. Kumiho reads AniList and MyAnimeList IDs from `metadata.json` and `metadata.txt` (or `series_metadata.txt`) beside the series folder. It accepts IDs or catalog URLs and fills missing IDs from the text file if the JSON file only has one catalog ID. Dango's community mapping can then resolve the supplied AniList or MAL identity to the other connected tracker.

The request uses `Authorization: Bearer <personal Dango API key>`. It does not include Kumiho user IDs or allow the JSON body to select a Dango account.

## Import catalog metadata from Dango

On a series metadata panel, **Import from Dango** sends the sidecar AniList/MAL IDs (or its title as a community-mapping fallback) to Dango's `POST /api/v1/catalog/resolve` endpoint. Kumiho applies the returned cover, description, genres, dates, and catalog-title variants through its regular metadata storage, downloading the cover into Kumiho's thumbnail storage.

Kumiho treats the local `metadata.json` title as its display preference: `clean_title` takes precedence over `title`. The catalog title returned by Dango is stored as an alternate/original title and does not replace that local display title. Dango itself returns catalog data and does not impose a display-title choice on clients.
