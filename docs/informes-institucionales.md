# Informes institucionales

## Rol Secretaria

`SECRETARIA` puede:

- ver dashboard, miembros, asistencia, seguimientos, alertas e informes
- crear y editar miembros
- registrar asistencia y seguimientos
- generar informes
- descargar PDF y Excel

No puede:

- eliminar administradores
- cambiar roles criticos
- modificar permisos
- acceder a auditoria de seguridad
- eliminar registros criticos

## Endpoints

- `GET /api/reports`: lista informes generados
- `POST /api/reports`: genera informe con filtros
- `GET /api/reports/export/excel`: descarga Excel institucional
- `GET /api/reports/export/pdf`: descarga PDF institucional

## Filtros soportados

- `from`
- `to`
- `mentorId`
- `leaderId`
- `status`
- `minAge`
- `maxAge`
- `gender`
- `baptized`
- `active`

## Excel

La exportacion usa ExcelJS cuando la dependencia esta instalada en Railway. Si el entorno local no tiene dependencias instaladas, el backend conserva un fallback compatible con Microsoft Excel en formato XML Spreadsheet 2003. Incluye hojas separadas:

- Estadisticas
- Miembros
- Seguimientos
- Asistencia

## PDF

La exportacion PDF usa generacion nativa del backend. El documento incluye portada institucional, fecha, responsable, resumen ejecutivo, estadisticas principales y nota metodologica.

## Auditoria

Cada generacion y descarga registra:

- usuario
- tipo de informe
- filtros aplicados
- formato descargado
- fecha

La trazabilidad se almacena en:

- `reports`
- `report_downloads`
- `activity_logs`
