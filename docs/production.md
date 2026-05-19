# Produccion

Variables minimas en Railway:

```env
NODE_ENV=production
JWT_SECRET=<secreto-largo-aleatorio>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<service-role-o-secret-key>
SUPABASE_ENFORCE_REMOTE=true
SUPABASE_ALLOW_INSECURE_PUBLISHABLE_WRITE=false
APP_BASE_URL=https://crm-generacion-de-gloria.up.railway.app
CORS_ORIGIN=https://crm-generacion-de-gloria.up.railway.app,https://crm-generacion-de-gloria-k1slpynjd.vercel.app
JWT_ACCESS_MINUTES=60
REFRESH_TOKEN_DAYS=30
PASSWORD_RESET_MINUTES=30
EMAIL_VERIFICATION_MINUTES=120
```

El backend falla al arrancar en produccion si falta Supabase remoto, si se usa el secreto demo o si se habilitan escrituras con publishable key.

## Verificacion

1. Ejecutar `docs/migrations/001_enterprise_auth_rbac.sql` en Supabase.
2. Confirmar `GET /api/health`.
3. Iniciar sesion con un usuario activo.
4. Validar que `/api/me` responda `storage.driver = "supabase"`.
5. Cerrar sesion para invalidar la sesion activa.

