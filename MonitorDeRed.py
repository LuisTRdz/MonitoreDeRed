import subprocess
import requests
from datetime import datetime, timedelta
import os
import platform
import time
import locale

# Configuración regional para nombres de mes
locale.setlocale(locale.LC_TIME, 'es_ES.UTF-8')

# Configuración general
DESTINATARIOS = [
    {"phone": "5218341488987", "apikey": "8082691"}, # Luis
    {"phone": "5218341316584", "apikey": "7842873"}, # Gustavo
    {"phone": "5218341436011", "apikey": "5982745"}, # Marte
    {"phone": "5218681011517", "apikey": "8716810"}  # Dionicio    
]

INTERVALO_MINUTOS = 1
LATENCIA_UMBRAL = 150  # ms

SERVIDORES = {
    "google.com": "8.8.8.8",
    "viaz-merweb1": "10.124.1.46",
    "viaz-merdb1": "10.124.1.53",
    "hqaz-merwebprd1": "10.21.0.40",
    "hqaz-merdbprd1": "10.21.0.42",
    "hqaz-mesdb1": "10.20.0.58"
}

estado_anterior = {nombre: True for nombre in SERVIDORES}
problema_activo = {nombre: False for nombre in SERVIDORES}
inicio_problema = {nombre: None for nombre in SERVIDORES}

# Nuevas variables para evitar duplicados
ultimo_evento = {nombre: None for nombre in SERVIDORES}
ultimo_mensaje = {nombre: "" for nombre in SERVIDORES}

# Variable global para latencia alta activa
latencia_alta_activa = {nombre: False for nombre in SERVIDORES}
inicio_latencia_alta = {nombre: None for nombre in SERVIDORES}

# Bandera para evitar que se abran consolas (solo en Windows)
NO_WINDOW = subprocess.CREATE_NO_WINDOW if platform.system().lower() == "windows" else 0


# 🔹 Función para hacer commit y push automático
def git_push_auto():
    try:
        subprocess.run(["git", "add", "."], check=True)
        fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        subprocess.run(["git", "commit", "-m", f"Auto-update logs {fecha}"], check=True)

        try:
            subprocess.run(["git", "push"], check=True)
        except subprocess.CalledProcessError:
            subprocess.run(["git", "push", "--set-upstream", "origin", "master"], check=True)

        print("[GIT] Cambios enviados a GitHub correctamente.")
    except Exception as e:
        print(f"[GIT ERROR] {e}")


def asegurar_directorio(nombre_servidor):
    if not os.path.exists(nombre_servidor):
        os.makedirs(nombre_servidor)

def obtener_nombre_archivo(nombre_servidor, tipo):
    ahora = datetime.now()
    inicio_semana = ahora - timedelta(days=ahora.weekday())
    fin_semana = inicio_semana + timedelta(days=6)
    nombre = f"{tipo}_red_{inicio_semana.strftime('%d_%b')}_al_{fin_semana.strftime('%d_%b_%Y')}.txt"
    nombre = nombre.lower().replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
    return os.path.join(nombre_servidor, nombre)

def log_status(nombre_servidor, mensaje):
    asegurar_directorio(nombre_servidor)
    archivo = obtener_nombre_archivo(nombre_servidor, "status")
    with open(archivo, "a", encoding="utf-8") as f:
        f.write(mensaje + "\n")

def log_problemas(nombre_servidor, mensaje):
    asegurar_directorio(nombre_servidor)
    archivo = obtener_nombre_archivo(nombre_servidor, "problemas")
    with open(archivo, "a", encoding="utf-8") as f:
        f.write(mensaje + "\n")

def hacer_ping(host):
    param = "-n" if platform.system().lower() == "windows" else "-c"
    try:
        resultado = subprocess.run(
            ["ping", param, "1", host],
            capture_output=True,
            text=True,
            creationflags=NO_WINDOW
        )
        if resultado.returncode == 0:
            for linea in resultado.stdout.split('\n'):
                if "time=" in linea.lower():
                    idx = linea.lower().find("time=")
                    if idx != -1:
                        latencia_str = linea[idx+5:].split(" ")[0].replace("ms", "").strip()
                        try:
                            latencia = float(latencia_str)
                            return True, latencia
                        except ValueError:
                            return False, None
            return False, None
        else:
            return False, None
    except Exception as e:
        print(f"[ERROR] Fallo en ping a {host}: {e}")
        return False, None

def hay_internet():
    estado, _ = hacer_ping("8.8.8.8")
    return estado

def enviar_whatsapp(mensaje, servidor, tipo_evento):
    global ultimo_evento, ultimo_mensaje
    if mensaje == ultimo_mensaje[servidor]:
        print(f"[WhatsApp] Mensaje duplicado para {servidor}, no se envía.")
        return
    ultimo_evento[servidor] = tipo_evento
    ultimo_mensaje[servidor] = mensaje

    mensaje_encoded = requests.utils.quote(mensaje)
    for destinatario in DESTINATARIOS:
        phone = destinatario["phone"]
        apikey = destinatario["apikey"]
        url = f"https://api.callmebot.com/whatsapp.php?phone={phone}&text={mensaje_encoded}&apikey={apikey}"
        try:
            respuesta = requests.get(url, timeout=10)
            if respuesta.status_code == 200:
                print(f"[WhatsApp] {phone} -> Enviado con éxito")
            else:
                print(f"[WhatsApp] {phone} -> Error HTTP {respuesta.status_code}")
        except Exception as e:
            print(f"[WhatsApp] Error con {phone}: {e}")

def main():
    global estado_anterior, problema_activo, inicio_problema
    global latencia_alta_activa, inicio_latencia_alta

    while True:
        ahora = datetime.now()
        print("\n" + "="*50)
        print(f"[{ahora.strftime('%d-%m-%Y %H:%M:%S')}] Iniciando ciclo de pruebas...")
        print("="*50)

        for nombre, ip in SERVIDORES.items():
            print(f"\n[Prueba] {nombre} ({ip})...")
            estado, latencia = hacer_ping(ip)
            estado_texto = "En línea" if estado else "Sin conexión"
            latencia_str = f"{latencia:.1f} ms" if latencia is not None else "N/D"

            log_line = f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | {estado_texto} | Latencia: {latencia_str}"
            log_status(nombre, log_line)
            print(f"   -> Resultado: {log_line}")

            # RECUPERACIÓN
            if estado and not estado_anterior[nombre] and problema_activo[nombre]:
                print(f"[Evento] RECUPERACIÓN detectada en {nombre}")
                fin_problema = ahora
                if inicio_problema[nombre] is not None:
                    duracion_str = str(fin_problema - inicio_problema[nombre]).split('.')[0]
                else:
                    duracion_str = "0:00:00"

                if latencia is not None and latencia > LATENCIA_UMBRAL:
                    mensaje = (f"✅ *{nombre} RECUPERADO pero con LATENCIA ALTA*\n"
                               f"🕒 {fin_problema.strftime('%d-%m-%Y %H:%M:%S')}\n"
                               f"🕓 *Duración del problema:* {duracion_str}\n"
                               f"🌐 *IP:* {ip}\n"
                               f"⚠️ *Latencia actual:* {latencia_str}")
                    if hay_internet():
                        enviar_whatsapp(mensaje, nombre, "recuperado_latencia")
                    log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | RECUPERADO con LATENCIA ALTA | Latencia: {latencia_str}")
                else:
                    mensaje = (f"✅ *{nombre} RECUPERADO y ESTABLE*\n"
                               f"🕒 {fin_problema.strftime('%d-%m-%Y %H:%M:%S')}\n"
                               f"🕓 *Duración del problema:* {duracion_str}\n"
                               f"🌐 IP: {ip}\n"
                               f"⚠️ *Latencia actual:* {latencia_str}")
                    if hay_internet():
                        enviar_whatsapp(mensaje, nombre, "recuperado")
                    log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | RECUPERADO ESTABLE | Latencia: {latencia_str}")

                problema_activo[nombre] = False
                inicio_problema[nombre] = None
                latencia_alta_activa[nombre] = False
                inicio_latencia_alta[nombre] = None

            # TIMEOUT con confirmación
            elif not estado and estado_anterior[nombre]:
                print(f"[Evento] TIMEOUT detectado en {nombre} - Confirmando...")
                pruebas_timeout = 0
                inicio_confirmacion = datetime.now()

                for i in range(1, 3+1):
                    print(f"   -> Prueba extra {i}/3...")
                    ok, _ = hacer_ping(ip)
                    if not ok:
                        pruebas_timeout += 1
                        print("      FALLÓ")
                    else:
                        print("      OK")

                    if i < 3:
                        time.sleep(5)

                if pruebas_timeout >= 2:
                    print(f"[Timeout Confirmado] {nombre} inaccesible")
                    if ultimo_evento[nombre] != "timeout":
                        inicio_problema[nombre] = ahora
                        mensaje = (f"❌ *{nombre} INACCESIBLE (Timeout)* ❌\n"
                                   f"{ahora.strftime('%d-%m-%Y %H:%M:%S')}\n"
                                   f"🌐 *IP:* {ip}")
                        if hay_internet():
                            enviar_whatsapp(mensaje, nombre, "timeout")
                        problema_activo[nombre] = True
                        log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | TIMEOUT | N/D")

            # LATENCIA ALTA
            elif estado and latencia is not None and latencia > LATENCIA_UMBRAL:
                print(f"[Evento] LATENCIA ALTA detectada en {nombre} ({latencia_str}) - Confirmando...")
                fallos_lat = 0

                for i in range(1, 3+1):
                    ok, lat_extra = hacer_ping(ip)
                    if ok and lat_extra and lat_extra > LATENCIA_UMBRAL:
                        fallos_lat += 1
                    elif not ok:
                        fallos_lat += 1
                    time.sleep(5) if i < 3 else None

                if fallos_lat >= 2 and not latencia_alta_activa[nombre]:
                    latencia_alta_activa[nombre] = True
                    inicio_latencia_alta[nombre] = ahora
                    mensaje = (f"⚠️ *{nombre} LATENCIA ALTA:* {latencia:.1f} ms\n"
                               f"📅 {ahora.strftime('%d-%m-%Y %H:%M:%S')}\n"
                               f"🌐 *IP:* {ip}")
                    if hay_internet():
                        enviar_whatsapp(mensaje, nombre, "latencia_alta")
                    log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | LATENCIA ALTA | {latencia:.1f} ms")

            # FIN de latencia alta
            elif latencia_alta_activa[nombre] and latencia is not None and latencia <= LATENCIA_UMBRAL:
                print(f"[Evento] FIN latencia alta en {nombre}")
                fin_latencia = ahora
                duracion = str(fin_latencia - inicio_latencia_alta[nombre]).split('.')[0]
                mensaje = (f"✅ *{nombre} LATENCIA ALTA finalizada*\n"
                           f"🌐 *IP:* {ip}\n"
                           f"⏳ *Duración:* {duracion}\n"
                           f"⚡ *Latencia actual:* {latencia:.1f} ms")
                if hay_internet():
                    enviar_whatsapp(mensaje, nombre, "latencia_fin")
                log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | FIN LATENCIA ALTA | {latencia:.1f} ms")

                latencia_alta_activa[nombre] = False
                inicio_latencia_alta[nombre] = None

            estado_anterior[nombre] = estado

        # 🔹 Al final de cada ciclo hacemos commit + push
        git_push_auto()

        print(f"\n[{datetime.now().strftime('%d-%m-%Y %H:%M:%S')}] Fin de ciclo. Esperando {INTERVALO_MINUTOS} min...")
        time.sleep(INTERVALO_MINUTOS * 60)

if __name__ == "__main__":
    main()