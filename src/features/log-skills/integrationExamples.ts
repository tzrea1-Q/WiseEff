const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** The UI and API integration check share these exact request bodies. */
export function buildSkillUploadExamples(apiOrigin: string, skillKey: string) {
  const endpoint = `${apiOrigin.replace(/\/$/, "")}/api/v1/log-files`;
  const body = { skillKey, fileName: "example.log", contentType: "text/plain", contentBase64: "SU5GTyB1cGxvYWQgZXhhbXBsZQo=" };
  const fields = { skillKey };
  const files = [
    { fieldName: "file", fileName: "application.log", contentType: "text/plain", content: "INFO application started\n" },
    { fieldName: "file", fileName: "system.log", contentType: "text/plain", content: "ERROR example timeout\n" }
  ];
  const authorization = '-H "Authorization: Bearer $WISEEFF_TOKEN"';
  return {
    endpoint,
    json: { body, curl: `curl --fail-with-body ${quote(endpoint)} \\\n  ${authorization} \\\n  -H 'Content-Type: application/json' \\\n  --data ${quote(JSON.stringify(body))}` },
    multipart: { fields, files, curl: `upload_dir=$(mktemp -d)\n${files.map((file) => `printf %s ${quote(file.content)} > "$upload_dir/${file.fileName}"`).join("\n")}\ncurl --fail-with-body ${quote(endpoint)} \\\n  ${authorization} \\\n  --form-string ${quote(`skillKey=${skillKey}`)} \\\n${files.map((file) => `  -F "file=@$upload_dir/${file.fileName};type=${file.contentType}"`).join(" \\\n")}\nrm -r "$upload_dir"` }
  };
}
