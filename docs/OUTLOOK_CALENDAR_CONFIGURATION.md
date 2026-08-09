# Outlook Calendar / Microsoft Entra ID

Zenda usa una sola aplicación OAuth para sincronizar Outlook Calendar. No se utiliza inicio de sesión con Microsoft.

```env
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
OUTLOOK_TENANT_ID=
OUTLOOK_REDIRECT_URI=http://localhost:3000/api/calendar/outlook/callback
```

`OUTLOOK_TENANT_ID` se usa tanto para autorización como para intercambio de tokens. Esto restringe la integración al tenant organizacional registrado en Microsoft Entra ID. Para admitir cuentas personales o varios tenants se requeriría cambiar explícitamente la política a `common`; no debe hacerse solo modificando una variable.

La redirect URI debe coincidir exactamente con la URI registrada en Entra ID. Outlook es opcional: si falta configuración, solo sus endpoints devuelven `503 OUTLOOK_NOT_CONFIGURED`; el backend sigue iniciando.

`AZURE_CLIENT_ID` es un alias heredado y no debe configurarse ni reutilizarse.
