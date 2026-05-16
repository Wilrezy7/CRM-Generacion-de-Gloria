# RBAC del CRM Generacion de Gloria

## Fuente de verdad

El rol ministerial vive en el modulo Miembros, campo `memberRole`. El rol de acceso vive en `users.role`.

Roles ministeriales soportados:

- `Pastor`
- `Lider`
- `Mentor`
- `Secretaria`
- `Miembro`
- `Visitante`
- `Nuevo`
- `Congregante`

Cada vez que se crea, edita o importa un miembro, el backend ejecuta sincronizacion con usuarios:

1. Normaliza el rol ministerial.
2. Busca un usuario vinculado por `memberId` o por correo.
3. Crea el usuario si el miembro tiene correo, no existe cuenta y el rol ministerial es `Administrador`, `Pastor`, `Lider`, `Mentor` o `Secretaria`.
4. Actualiza `fullName`, `email`, `role`, `memberRole` y `active`.
5. Recalcula asignaciones.
6. Desactiva cuentas vinculadas a miembros eliminados.

Las cuentas sincronizadas reciben temporalmente la contrasena inicial `Cambio123*` si no tenian una. En produccion debe cambiarse por flujo de invitacion o restablecimiento de contrasena.

## Roles del sistema

El sistema traduce el rol ministerial a una clave interna:

| Miembro | Sistema |
| --- | --- |
| Pastor | `PASTOR` |
| Lider | `LIDER` |
| Mentor | `MENTOR` |
| Secretaria | `SECRETARIA` |
| Miembro | sin acceso al CRM |
| Visitante | sin acceso al CRM |
| Nuevo | sin acceso al CRM |
| Congregante | sin acceso al CRM |

## Permisos

La matriz de permisos esta centralizada en:

- `backend/src/services/rbac.js`

Permisos principales:

- `dashboard:view`
- `members:view`
- `members:create`
- `members:update`
- `members:delete`
- `members:assign`
- `members:import`
- `attendance:view`
- `attendance:create`
- `interactions:view`
- `interactions:create`
- `alerts:view`
- `alerts:attend`
- `users:view`
- `users:manage`
- `reports:export`
- `reports:view`
- `reports:generate`
- `settings:manage`

## Alcance por rol

`ADMIN`

- acceso total
- gestiona usuarios manuales de emergencia
- elimina miembros
- importa y exporta
- gestiona configuracion

`PASTOR`

- ve todos los miembros
- crea y edita miembros
- asigna mentores
- registra asistencia, seguimientos y alertas
- exporta reportes

`LIDER`

- ve todos los miembros
- crea y edita miembros
- asigna mentores
- registra asistencia, seguimientos y alertas
- exporta reportes

`MENTOR`

- ve sus miembros asignados y su propio registro
- registra asistencia y seguimiento sobre su alcance
- atiende alertas de sus asignados
- no accede a usuarios ni configuracion global

`SECRETARIA`

- ve dashboard, miembros, asistencia, seguimientos, alertas e informes
- crea y edita miembros
- registra asistencia y seguimientos
- genera y descarga informes PDF/Excel
- no elimina registros criticos
- no gestiona roles, permisos, configuracion sensible ni auditoria

## Asignacion de mentores

El selector de asignacion en Miembros ya no depende de usuarios manuales.

Fuente del selector:

- miembros activos cuyo `memberRole` es `Pastor`, `Lider` o `Mentor`
- con cuenta sincronizada automaticamente (`accountId`)

Si un miembro pasa a `Pastor`, `Lider` o `Mentor`, aparece como persona asignable para mentoreo tras guardar. Si cambia a otro rol o queda inactivo, deja de aparecer y sus asignaciones se limpian al sincronizar.

## Acceso al modulo Usuarios

El modulo Usuarios filtra exclusivamente estos roles de sistema:

- `ADMIN`
- `PASTOR`
- `LIDER`
- `MENTOR`
- `SECRETARIA`

Los miembros con rol ministerial `Miembro`, `Visitante`, `Nuevo` o `Congregante` no generan credenciales, no aparecen en Usuarios y no pueden iniciar sesion. Si una persona tenia cuenta y su rol cambia a uno de esos roles no autorizados, el backend desactiva el acceso y revoca sus asignaciones.

## Validacion backend y frontend

Backend:

- todas las operaciones sensibles pasan por `requirePermission`
- la visibilidad de miembros se calcula con `canAccessYouth`
- no se confia en botones ocultos del frontend

Frontend:

- los tabs y botones leen `user.permissions`
- los botones ocultos solo mejoran UX; el backend sigue siendo la autoridad

## Persistencia

El proyecto actual usa una tabla agregada en Supabase (`crm_state`) que guarda el estado completo como JSON. Por eso no se requieren migraciones relacionales obligatorias para activar RBAC.

Campos nuevos o normalizados dentro del JSON:

- `users[].memberId`
- `users[].memberRole`
- `users[].role`
- `youths[].memberRole`
- `youths[].assignedUserId`

Si el proyecto se migra luego a tablas normalizadas, las relaciones recomendadas son:

- `members.id` -> `users.member_id`
- `members.member_role` con constraint de roles permitidos
- `members.assigned_user_id` -> `users.id`
