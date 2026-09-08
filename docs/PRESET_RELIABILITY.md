# Preset reliability

## Investigation: September 8, 2026

The server's persisted generation records showed the following outcomes before
the prompt changes. These include earlier testing and are observational counts
of generation records, not a controlled measurement of failure probabilities.
Camera gallery deletions do not remove these server records.

| Style | Prompt version | Complete | Content filtered | Other failures |
| --- | --- | ---: | ---: | ---: |
| After the End | 1 | 0 | 0 | 2 |
| After the End | 2 | 5 | 9 | 0 |
| First Contact | 1 | 3 | 6 | 0 |
| Tiny Clay World | 1 | 7 | 0 | 0 |
| Found in 1997 | 1 | 3 | 0 | 0 |
| Fridge Masterpiece | 1 | 10 | 0 | 0 |
| Bedtime Legend | 1 | 7 | 0 | 0 |

Recent production logs confirm Meta HTTP 400 responses stating that the response
was filtered due to the prompt triggering its content management policy. MuseCam
classifies this as `content_filtered` and returns HTTP 422. Meta's message does
not identify a policy category or reliably distinguish input, prompt, and output
filtering. There is no evidence here for a specific violence, nudity, or other
category. Two early failures predate this classification and remain unknown.

## Prompt changes

- **After the End v3:** specify peaceful, weathered surroundings reclaimed by
  nature, with calm, healthy subjects and clothing preserved.
- **First Contact v2:** specify a friendly background companion and welcoming
  science-fiction details, keeping existing people and animals separate and intact.
- Keep the four successful styles' prompts and versions unchanged.
- Keep provider filtering and single-attempt behavior unchanged. No hidden
  fallback style or automatic retry of rejected generations is introduced.

The shared preservation instruction still preserves identity, pose, composition,
and scene geometry. Style IDs remain stable so existing galleries and the device
continue to work. New generations record the new prompt version. Failure logs now
include preset ID, preset version, and classified error code alongside the photo ID.

## Live spot check

Ten direct Meta requests used the production provider implementation and input
normalization with three previously rejected originals: an empty room, a dog on
a couch, and a clothed portrait. They created no camera or server gallery entries
and did not publish the images. Successful outputs were visually inspected.

| Style | Prompt version | Complete | Filtered | Inputs |
| --- | --- | ---: | ---: | --- |
| After the End | 2, previous | 2 | 0 | Room, portrait |
| After the End | 3, revised | 3 | 1 | Room twice, dog, portrait |
| First Contact | 1, previous | 0 | 1 | Dog |
| First Contact | 2, revised | 3 | 0 | Room, dog, portrait |

First Contact's result is encouraging but too small to establish a reliable rate.
For After the End, the revised prompt rejected the room once and accepted it on a
second request; the previous prompt also accepted it during this check despite
earlier rejection. Its measured improvement is therefore **not established**.
The v3 change is a clearer expression of the intended peaceful aesthetic, not a
guaranteed filtering fix. No individual word or policy category was isolated as
the cause. Further evidence should come from ordinary captures grouped by version.

## Comparing future outcomes

Group by both preset ID and version; combining old and new prompts hides whether
the change helped. The database read below does not retrieve images or credentials.

```sql
SELECT preset_id, preset_version, status, error_code, COUNT(*) AS captures
FROM photos
GROUP BY preset_id, preset_version, status, error_code
ORDER BY preset_id, preset_version, status, error_code;
```

Retry from the camera gallery creates a new capture using the currently deployed
prompt. Sending the old capture ID again returns its existing result by design.
