# Find and maintain engineering knowledge

> Chinese: [Chinese](../zh-CN/user-guide/knowledge.md)

## Who can do this

- Active Organization members with `knowledge:view` can browse and search in Knowledge base (`/knowledge`). This includes guests, hardware users, software users, hardware/software committers, Organization Admins (`admin`), and Platform Admins (`platform-admin`) under the default roles.
- Hardware/software users and committers have `knowledge:edit`: they can create entries and edit, publish, archive, or restore their own entries. Managing someone else's entries requires additional permission.
- Organization Admins and Platform Admins also have `knowledge:manage`: they can maintain other people's entries and use Knowledge admin (`/knowledge-admin`) to check index health and manage Agent drafts and archived entries. These operations are limited to the current Organization.

Drafts are visible only to their creator and knowledge managers. Members with view permission can read published and archived entries; search and Xiaoze knowledge retrieval use only published entries. For account and role setup, see [Account and access](account-and-access.md).

## Find a published answer

1. Open Knowledge base (`/knowledge`). Without an active search, use the status and tag filters to browse entries you can read. Use tags to identify projects or topics; the knowledge base has no folder hierarchy.
2. Enter a question or keywords in the knowledge search field and select Search. Full-text search supports Chinese and English. Results include only published entries; drafts and archived material are excluded.
3. Open a result to read its content, tags, source, and current revision. For a file entry, inspect its text-extraction status and download the original file when needed.
4. Check the retrieval-mode label to see whether semantic search is available. It reports either semantic plus full-text retrieval or full-text only. Select Clear search to return to the entry list and its filters.

In an API-backed deployment, select Ask the knowledge base (Xiaoze) on Knowledge base (`/knowledge`) to open the Xiaoze conversation panel. Ask your question there; text in the search field is not sent automatically. Xiaoze can retrieve published knowledge through its tools and provide citation links to the original entries. Open those sources and check their applicability before relying on an answer. This entry point is unavailable in mock mode, and Xiaoze-created drafts must be published before they can be retrieved.

![Knowledge search and entry list](images/knowledge-library.png)

*The knowledge library contains three published demo entries about thermal foldback, parameter review, and device setup.*

![Published thermal foldback knowledge entry with source and revision](images/knowledge-entry-detail.png)

*The published sample entry shows its troubleshooting text, tags, human source, and revision; it does not certify a real device diagnosis.*

## Create an entry or upload a file

On Knowledge base (`/knowledge`), choose the content form that fits your material:

- Select New Markdown entry and enter a title, comma-separated tags, and the content. Project tags can help identify where the guidance applies. Check the preview, then select Create draft.
- Select Upload file entry, enter a title and tags, choose a file, and select Upload and create draft. Each upload creates a separate entry.

Markdown (`.md`) and plain-text (`.txt`) uploads become editable Markdown drafts. They must use UTF-8 and contain at most 200,000 characters, with 20 MB per file. Edit them in product and save new revisions. The analysis-skill workspace’s Upload Markdown / text action uses the same conversion and links the new draft to the skill; save the skill draft to retain its links. Existing Markdown uploads stored as file entries keep their original form.

PDF and Word `.docx` remain file entries. You can replace their originals, but cannot edit them in the Markdown editor. A file with no extractable text is marked Unsearchable in the list, with the extraction reason in its detail. Replace it with a text-bearing version; publishing alone cannot make its body searchable. The picker also accepts legacy `.doc`, but the extractor does not support its binary format; convert it to `.docx` before replacing it.

The Origin column and filter distinguish Written here, Uploaded, Distilled, Xiaoze draft, and Skill-package import. Origin describes provenance; it does not grant access or make a draft retrievable.

New entries start as drafts. Review the content, applicable conditions, and source evidence before publishing. Only after publication can the entry appear in search or Xiaoze knowledge retrieval.

When a Xiaoze-created draft cites a degraded source log analysis, the platform automatically adds a source notice at the top of the body, using the same notice as distilled drafts. It identifies rule fallback or early convergence, explains the limitation, and asks you to review the evidence before relying on the conclusion. An identical notice already at the start is not added again. Drafts citing non-degraded or legacy analyses, and drafts without a source log, remain unchanged. You can edit the notice as part of the draft. It does not block publication or guarantee content quality.

![New Markdown knowledge entry dialog](images/knowledge-new-entry.png)

*The new-entry dialog alongside the published examples; this screenshot does not create another draft.*

## Import several documents

On `/knowledge`, select Batch import, choose several PDF, DOCX, TXT or MD files or one `.zip`, and optionally enter comma-separated batch tags. Each batch accepts at most 200 documents and 100 MB after expansion, with 20 MB per document. ZIP folders may nest up to 20 levels. Folder names become tags alongside batch tags, not a folder hierarchy. Each entry accepts at most 20 tags of 60 characters each; the report warns when folder names are truncated or excess tags are omitted.

Select Start import to follow per-document progress. Each supported document creates an independent draft; byte-identical readable content is skipped, never overwritten. Changed content creates a new draft. The report lists created drafts, duplicates, unsupported formats, extraction failures and refused documents, with links to available entries and tag warnings. Extraction failures retain file drafts for replacement. Review the report and publish drafts after checking them. Closing the dialog or leaving the page does not cancel documents already submitted. If the summary fails, Retry summary preserves document results without uploading again.

## Review suggested definition references

Indexing drafts and published revisions detects exact, case-sensitive property keys of at least four characters in the entry text. Open entry detail and select Edit (or Link parameter definitions for a file), then review Suggested links. Suggestions are grouped by key, ordered by mention count, and show the module, evidence snippet and PDF page when available. Deprecated definitions are labelled as deprecated; retired definitions are excluded.

Only the entry owner with edit permission or a knowledge manager can read or act on suggestions. Accept creates an audited definition reference; Ignore remembers the dismissal for that entry and definition. Accept all processes each remaining suggestion separately and retains completed decisions if one fails. The same key in several modules produces separate candidates. Until accepted, suggestions change neither related knowledge nor retrieval; accepted references enter related knowledge only once the entry is published.

Suggestions follow the latest revision: a pending suggestion is withdrawn when its key disappears and may return when the key reappears. Archived entries hide suggestions and skip detection; restoring an entry queues detection against its head revision. Accepted references and dismissals stay unchanged.

Existing non-archived entries that have never completed detection are queued on server startup. After the catalog gains definitions, a knowledge manager can select Rescan suggested links in the index health tab on `/knowledge-admin` to enqueue all the organization's non-archived entries, including drafts. Detection runs in the background; the admin action is audited and preserves accepted references and dismissals.

## Manage entries in batches

Select entries in the list, then choose Add tags, Remove tags, Publish or Archive, up to 200 entries at a time. Tag changes preserve other tags and content. Publishing applies to drafts; archiving applies to published entries and removes them from retrieval while retaining history. Permissions are checked per entry: owners need edit permission, and knowledge managers may maintain others’ entries. The result table reports each success or refusal; one failure does not undo other successful entries.

## Link knowledge from a definition

On a parameter definition’s detail page, select Link existing knowledge. Choose a non-archived entry you govern as its owner with edit permission or as a knowledge manager. The link records an explicit definition reference; it does not publish the entry. Definition-related retrieval includes only published references. Archived skill bindings remain visible as archived and excluded from retrieval; deleted entries are shown as deleted and can be unlinked.

## Publish and revise an entry

1. On Knowledge base (`/knowledge`), open a draft you own, or one you can maintain as a manager, and select Publish. Publication makes the entry eligible for retrieval and queues an index refresh, which may take time to complete.
2. To update a Markdown entry, select Edit, make the changes, and select Save as new revision. For a file entry, select Replace file, supply the replacement, and select Replace and create new revision. Old file versions remain in revision history.
3. Every content save appends an immutable revision. A published entry stays published after saving; there is no pending-changes approval state. Check the content first: saving directly updates the published body and queues an index refresh.
4. Open Revision history to inspect earlier versions. For a non-archived entry, an owner with edit permission or a manager can choose Restore this version, then confirm Restore as new revision. This appends another revision while preserving the existing history and publication status.

If a save reports that someone else has updated the current revision, your save encountered a conflict and has not succeeded. Preserve your edits, refresh the entry, compare the changes, and retry against the current revision.

## Archive outdated knowledge or restore it

On Knowledge base (`/knowledge`), open a published entry you can maintain and select Archive. Archiving removes it from retrieval and preserves its content and history. Use the archived status filter to find it later, then select Restore as published to publish it again. Restore an archived entry before editing its content.

On Knowledge admin (`/knowledge-admin`), managers can also restore entries from the archived list. Permanently delete requires an acknowledgement during confirmation and removes the entry and all revisions irreversibly. If you only need to retire outdated guidance, archive it.

Managers with `knowledge:manage` can also permanently delete a human-authored draft directly from its detail or the row's More menu on Knowledge base (`/knowledge`), without publishing or archiving it first. Confirm the scope and acknowledge the irreversible action. Deletion removes the entry, all revisions, file metadata, parameter references and linked retrieval/index records; audit records remain. Original file objects in storage are retained by the existing deletion contract. Other entries, shared parameter definitions and source logs are not deleted. Cancelling leaves the draft unchanged; a failed request keeps the confirmation and its error available for retry. If another administrator has already deleted it, the request reports that the entry no longer exists; close the dialog and refresh the list.

In the Agent-draft queue on Knowledge admin (`/knowledge-admin`), managers can check the creator and available session or source links, then publish the reviewed content or reject and archive it. Rejecting a draft directly into archive is available only for Agent drafts. Ordinary drafts must be published before the normal archive action is available.

## Check index health and request a rebuild

Knowledge managers open Knowledge admin (`/knowledge-admin`) and go to Retrieval index health:

1. Check the retrieval-mode banner. Full-text-only mode means semantic retrieval is degraded or unavailable; it does not mean full-text search is disabled. The banner also reports vector support and whether an embedding endpoint is configured. Ask the operator to resolve deployment problems.
2. Inspect each entry's publication status, indexed revision number, index status, chunk counts, and failure reason. The index states are Pending, Processing, Indexed, and Failed. Compare the indexed revision with the current revision to check whether the latest content has been processed.
3. For an affected entry, read the failure reason and address the underlying issue, such as replacing a file whose extraction failed, then select Retry. Unsupported file formats or unavailable services must be resolved first; repeated retries will not help.
4. Select Rebuild all indexes when indexes for the published entries need rebuilding. The notice reports how many published entries were added back to the background queue. This confirms that work was queued, not that rebuilding has finished. Use Refresh to check outcomes and remaining failures.

An index failure may come from text extraction or embedding generation. To assess whether full-text search is available, check the failure reason and actual retrieval mode alongside the status badge.

## Find the maintained references

- [Account and access](account-and-access.md): registration and role administration.
- [Knowledge retrieval architecture decision](../adr/0025-knowledge-retrieval-lives-in-postgres.md): retrieval architecture for developers and operators.
- [User-operation coverage matrix](../developer/user-operation-coverage-matrix.md): an index of knowledge operations and acceptance tests in the repository. Your deployment needs its own verification.
