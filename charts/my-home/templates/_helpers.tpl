{{- define "my-home.labels" -}}
app.kubernetes.io/name: my-home
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
{{- define "my-home.selector" -}}
app.kubernetes.io/name: my-home
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- define "my-home.image" -}}
{{- $image := index .root.Values.images .role -}}
{{- if not $image.digest }}{{ fail (printf "images.%s.digest is required: charts deploy only stamped image digests" .role) }}{{ end -}}
{{ printf "%s@%s" $image.repository $image.digest | quote }}
{{- end }}
{{- define "my-home.security" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end }}
{{- define "my-home.apiEnv" -}}
- name: NODE_ENV
  value: production
- name: APP_COMMIT
  value: {{ .Chart.AppVersion | quote }}
- name: LOG_LEVEL
  value: {{ .Values.api.logLevel | quote }}
- name: MIGRATE_ON_START
  value: "false"
- name: SEED_ON_START
  value: "false"
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.secretName }}
      key: DATABASE_URL
{{- end }}
