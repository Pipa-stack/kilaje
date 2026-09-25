# Kilaje en Google Play

Todo lo que hace falta para publicar Kilaje en Google Play como **TWA** (Trusted Web
Activity): la app de Android es un envoltorio oficial de Google que abre
`https://kilaje.up.railway.app` a pantalla completa. No hay que reescribir nada, y cada
despliegue de la web actualiza la app sin pasar por la tienda.

## Lo que hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `icono-512.png` | Icono de la ficha (512×512, PNG con transparencia) |
| `cabecera-1024x500.png` | Gráfico de funciones (1024×500, sin transparencia). Se genera desde `cabecera.html` |
| `capturas/*.png` | 7 capturas de teléfono, 1080×1920 |

## 1. Antes de nada (solo lo puede hacer el titular)

1. **Cuenta de desarrollador** en <https://play.google.com/console>: 25 $, pago único,
   con DNI y una tarjeta a tu nombre. Tipo **personal**.
2. **Verificar un móvil**: con la app *Play Console* en un Android real (versión 10 o superior).
3. **Estado de comerciante (DSA, UE)**: en *Detalles de la cuenta*. Si cobras al gimnasio
   por la app eres *comerciante* y tus datos de contacto salen públicos en la ficha.

## 2. Variables en Railway

| Variable | Valor |
|---|---|
| `PRIVACY_OWNER` | Nombre o razón social del responsable de los datos (tú o el gimnasio) |
| `PRIVACY_CONTACT` | Correo de contacto para privacidad |
| `TWA_PACKAGE` | `es.kilaje.app` |
| `TWA_SHA256_FINGERPRINTS` | Las dos huellas del paso 3, separadas por coma |

Sin las dos primeras, `/privacidad` no dice quién es el responsable. Sin las dos últimas,
`/.well-known/assetlinks.json` contesta 404 y la app se abre con la barra de direcciones
del navegador.

## 3. Generar la app de Android

Requiere Node y descarga Java y el SDK de Android la primera vez (~1 GB).

```bash
npx @bubblewrap/cli init --manifest=https://kilaje.up.railway.app/manifest.webmanifest
```

Respuestas:

- **Application ID / package:** `es.kilaje.app`
- **Name:** `Kilaje` · **Launcher name:** `Kilaje`
- **Display:** `standalone` · **Orientation:** `portrait`
- **Theme color:** `#0E100F` · **Background color:** `#F2C200`
- **Notifications:** no
- **Signing key:** créala nueva. **Guarda el archivo `.keystore` y sus contraseñas fuera
  del ordenador** (gestor de contraseñas o nube). Es la *clave de subida*: si se pierde,
  Google permite cambiarla, pero con trámite.

```bash
npx @bubblewrap/cli build
```

Sale `app-release-bundle.aab`. Comprueba en `app/build.gradle` que `targetSdkVersion`
es **36**, obligatorio para apps nuevas desde el 31 de agosto de 2026.

Huellas para `TWA_SHA256_FINGERPRINTS`:

- la de la **clave de subida**: `keytool -list -v -keystore android.keystore`
- la de la **clave de firma de Google**: Play Console → la app → *Integridad de la app* →
  *Firma de apps*. **Esta es la que más se olvida**, y sin ella la verificación falla en
  los móviles que instalan desde la tienda.

## 4. Ficha de la tienda

- **Nombre:** Kilaje
- **Descripción breve** (74/80):
  > Reserva tus clases del gimnasio en un calendario y lleva tu entrenamiento.
- **Descripción completa:**
  > Kilaje es la app de tu gimnasio.
  >
  > RESERVA TUS CLASES
  > • Un calendario con los próximos días: tocas el día y ves las horas con los huecos libres.
  > • Reservas con un toque y anulas hasta una hora antes.
  > • Si una clase está completa te apuntas a la lista de espera: cuando alguien anula entras solo, por orden, y te llega un correo.
  > • Ves tus reservas y tu historial de clases.
  >
  > LLEVA TU ENTRENAMIENTO
  > • Importa la plantilla de Excel de tu entrenador o monta tu plan a mano.
  > • Anota peso, repeticiones y RIR con campos grandes, pensados para usar entre serie y serie.
  > • Temporizador de descanso, cálculo de discos, récords personales y la evolución de cada ejercicio.
  > • Funciona sin cobertura: lo que anotas se guarda y se envía al volver la conexión.
  >
  > PARA QUIEN LLEVA EL GIMNASIO
  > • Agenda del día con la ocupación de cada clase, lista de apuntados y pasar lista.
  > • Horario semanal, anular un día festivo con aviso a los apuntados, avisos para todos.
  > • Socios, cuotas y planes de entrenamiento con la misma plantilla de Excel.
  >
  > Sin anuncios.
- **Categoría:** Salud y bienestar (*Health & Fitness*)
- **Correo de contacto:** el de `PRIVACY_CONTACT`
- **Política de privacidad:** `https://kilaje.up.railway.app/privacidad`

## 5. Contenido de la app (formularios de Play Console)

| Formulario | Respuesta |
|---|---|
| Política de privacidad | `https://kilaje.up.railway.app/privacidad` |
| Acceso a la app | Hace falta iniciar sesión: ver el punto 6 |
| Anuncios | No contiene anuncios |
| Clasificación de contenido (IARC) | Categoría *Utilidad/Productividad*; sin violencia, sexo, drogas, apuestas ni interacción entre usuarios. Sale *Para todos / PEGI 3* |
| Público objetivo | **18 años o más** (evita la política de familias) |
| Apps de salud | *Actividad y fitness*. No es un dispositivo médico |
| Funciones financieras | Ninguna |
| App de gobierno | No |
| Borrado de cuenta | Enlace: `https://kilaje.up.railway.app/borrar-cuenta` |

**Seguridad de los datos:**

- ¿Recoge datos? **Sí**. ¿Cifrados en tránsito? **Sí**. ¿Se pueden borrar? **Sí**, con el
  enlace de arriba.
- ¿Se comparten con terceros? **No**. Railway y Brevo son encargados del tratamiento, y Google
  no lo cuenta como compartir.
- Datos recogidos, todos **obligatorios salvo el entrenamiento**, para *funcionalidad de la
  app* y *gestión de la cuenta*:
  - **Información personal:** nombre, dirección de correo, ID de usuario
  - **Salud y fitness:** información de fitness (entrenamientos; opcional)
  - **Actividad en la app:** interacciones (reservas y asistencia)
- No recoge ubicación, contactos, fotos, datos financieros ni identificadores del dispositivo.

## 6. Cuentas para los revisores de Google

Google exige credenciales que funcionen siempre, en inglés si es posible, y que no sean
de nadie real. Después de desplegar:

1. Registrar `revisor.socio@…` y `revisor.gestor@…` con correos tuyos y contraseñas largas.
2. Hacer administrador a `revisor.gestor` desde *Gestión → Socios → Hacer administrador*.
3. Ponerlas en *Contenido de la app → Acceso a la app*, con esta nota:
   > Kilaje is a gym app. Member account: book classes in the Clases tab (tap a day, then an
   > hour, then Reservar) and log workouts. Admin account: manage the gym in Agenda, Socios,
   > Horario and Avisos. Please cancel any class you book so real members keep their place.

Los revisores reservan clases reales: la nota les pide anularlas.

## 7. Prueba cerrada obligatoria

Las cuentas personales nuevas necesitan una **prueba cerrada con 12 personas o más,
apuntadas los 14 días seguidos**, antes de poder publicar en producción.

1. *Pruebas → Prueba cerrada*: crea una pista, sube el `.aab` y añade una lista con los
   correos de Google de los probadores. Tus socios valen.
2. Comparte el enlace de la prueba. Que la instalen **desde ese enlace** y la usen.
3. Pasados los 14 días, *Solicitar acceso a producción*. Google contesta en unos 7 días.

## Calendario realista

| Semana | Qué |
|---|---|
| 1 | Cuenta, verificación, variables en Railway, generar el `.aab`, ficha y formularios, prueba cerrada en marcha |
| 2–3 | Los 14 días de prueba cerrada |
| 3–4 | Solicitud de producción y revisión (hasta 7 días) |
