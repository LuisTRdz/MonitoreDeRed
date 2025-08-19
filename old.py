import subprocess
import json
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
    {"phone": "5218681011517", "apikey": "8716810"} # Dionicio    
]

INTERVALO_MINUTOS = 1
LATENCIA_UMBRAL = 150  # ms
WAIT_SPEEDTEST_MINUTOS = 1

SERVIDORES = {
    "google.com" : "8.8.8.8",
    "viaz-merweb1" : "10.124.1.46",
    "viaz-merdb1": "10.124.1.53",
    "hqaz-merwebprd1": "10.21.0.40",
    "hqaz-merdbprd1": "10.21.0.42",
    "hqaz-mesdb1": "10.20.0.58"
    }

estado_anterior = {nombre: True for nombre in SERVIDORES}
problema_activo = {nombre: False for nombre in SERVIDORES}
inicio_problema = {nombre: None for nombre in SERVIDORES}
ultimo_speedtest_regular = {nombre: datetime.min for nombre in SERVIDORES}

# Nuevas variables para evitar duplicados
# Posibles valores: "timeout", "recuperado", "recuperado_latencia", "latencia_alta", "latencia_fin"
ultimo_evento = {nombre: None for nombre in SERVIDORES}
ultimo_mensaje = {nombre: "" for nombre in SERVIDORES}   # Guarda último texto enviado

# Variable global para latencia alta activa
latencia_alta_activa = {nombre: False for nombre in SERVIDORES}
inicio_latencia_alta = {nombre: None for nombre in SERVIDORES}

# Bandera para evitar que se abran consolas (solo en Windows)
NO_WINDOW = subprocess.CREATE_NO_WINDOW if platform.system().lower() == "windows" else 0

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
            # Si hubo respuesta pero no se pudo parsear la latencia, lo tomamos como fallo
            return False, None
        else:
            return False, None
    except Exception as e:
        print(f"[ERROR] Fallo en ping a {host}: {e}")
        return False, None

def medir_speedtest_ookla():
    try:
        print("[Speedtest] Ejecutando prueba de velocidad...")
        resultado = subprocess.run(
            ["speedtest.exe", "--format=json"],
            capture_output=True,
            text=True,
            creationflags=NO_WINDOW
        )
        data = json.loads(resultado.stdout)

        descarga = data['download']['bandwidth'] * 8 / 1_000_000
        subida = data['upload']['bandwidth'] * 8 / 1_000_000
        ip = data['interface']['externalIp']
        servidor = data['server']['name']

        print(f"[Speedtest] Descarga: {descarga:.2f} Mbps | Subida: {subida:.2f} Mbps | IP: {ip} | Servidor: {servidor}")
        return round(descarga, 2), round(subida, 2), ip, servidor
    except Exception as e:
        print("Error al ejecutar speedtest.exe:", e)
        return None, None, None, None

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
    global estado_anterior, problema_activo, inicio_problema, ultimo_speedtest_regular
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

            # =========================
            # RECUPERACIÓN
            # =========================
            if estado and not estado_anterior[nombre] and problema_activo[nombre]:
                print(f"[Evento] RECUPERACIÓN detectada en {nombre}")
                fin_problema = ahora
                if inicio_problema[nombre] is not None:
                    duracion_str = str(fin_problema - inicio_problema[nombre]).split('.')[0]
                else:
                    duracion_str = "0:00:00"

                descarga, subida, _, _ = medir_speedtest_ookla()

                if latencia is not None and latencia > LATENCIA_UMBRAL:
                    mensaje = (f"✅ *{nombre} RECUPERADO pero con LATENCIA ALTA*\n"
                               f"🕒 {fin_problema.strftime('%d-%m-%Y %H:%M:%S')}\n"
                               f"🕓 *Duración del problema:* {duracion_str}\n"
                               f"🌐 *IP:* {ip}\n"
                               f"📈 *Descarga:* {descarga or 'Error'} Mbps\n"
                               f"📤 *Subida:* {subida or 'Error'} Mbps\n"
                               f"⚠️ *Latencia actual:* {latencia_str}")
                    if hay_internet():
                        enviar_whatsapp(mensaje, nombre, "recuperado_latencia")
                    # Log problema recuperación con latencia alta
                    log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | RECUPERADO pero con LATENCIA ALTA | Latencia: {latencia_str}")
                else:
                    mensaje = (f"✅ *{nombre} RECUPERADO y ESTABLE*\n"
                               f"🕒 {fin_problema.strftime('%d-%m-%Y %H:%M:%S')}\n"
                               f"🕓 *Duración del problema:* {duracion_str}\n"
                               f"🌐 IP: {ip}\n"
                               f"⚠️ *Latencia actual:* {latencia_str}\n"
                               f"📈 *Descarga:* {descarga or 'Error'} Mbps\n"
                               f"📤 *Subida:* {subida or 'Error'} Mbps")
                    if hay_internet():
                        enviar_whatsapp(mensaje, nombre, "recuperado")
                    # Log problema recuperación estable
                    log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | RECUPERADO y ESTABLE | Latencia: {latencia_str}")

                problema_activo[nombre] = False
                inicio_problema[nombre] = None
                latencia_alta_activa[nombre] = False
                inicio_latencia_alta[nombre] = None

            # =========================
            # TIMEOUT (sin respuesta) con FILTRO 3 intentos / 5s
            # =========================
            elif not estado and estado_anterior[nombre]:
                print(f"[Evento] TIMEOUT detectado en {nombre} - Iniciando pruebas de confirmación...")
                pruebas_timeout = 0
                inicio_confirmacion = datetime.now()

                for i in range(1, 4):
                    print(f"   -> Prueba extra {i}/3...")
                    ok, _ = hacer_ping(ip)
                    if not ok:
                        pruebas_timeout += 1
                        print("      Resultado: FALLÓ (timeout)")
                    else:
                        print("      Resultado: OK (respondió)")

                    if i < 3:
                        time.sleep(5)  # Espera de 5 segundos entre intentos

                fin_confirmacion = datetime.now()
                tiempo_total = (fin_confirmacion - inicio_confirmacion).total_seconds()
                print(f"[Confirmación Timeout] Fallos: {pruebas_timeout}/3 | Tiempo total: {tiempo_total:.1f} seg")

                if pruebas_timeout >= 2:
                    print(f"[Confirmación Timeout] El timeout de {nombre} se confirma. Ejecutando speedtest y enviando alerta.")
                    if ultimo_evento[nombre] != "timeout":
                        inicio_problema[nombre] = ahora
                        descarga, subida, _, _ = medir_speedtest_ookla()
                        mensaje = (f"❌ *{nombre} INACCESIBLE (Timeout)* ❌\n"
                                   f"{ahora.strftime('%d-%m-%Y %H:%M:%S')}\n"
                                   f"🌐 *IP:* {ip}\n"
                                   f"📈 *Descarga:* {descarga or 'Error'} Mbps\n"
                                   f"📤 *Subida:* {subida or 'Error'} Mbps")
                        if hay_internet():
                            enviar_whatsapp(mensaje, nombre, "timeout")
                        problema_activo[nombre] = True
                        # Log problema timeout
                        log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | TIMEOUT | N/D")
                else:
                    print(f"[Confirmación Timeout] Timeout no confirmado (menos de 2/3). No se envía alerta.")

            # =========================
            # LATENCIA ALTA con FILTRO 3 intentos / 5s
            # =========================
            elif estado and latencia is not None and latencia > LATENCIA_UMBRAL:
                print(f"[Evento] LATENCIA ALTA detectada en {nombre} (ping inicial: {latencia_str}) - Iniciando pruebas de confirmación...")
                fallos_por_latencia = 0
                inicio_confirmacion_lat = datetime.now()

                for i in range(1, 4):
                    print(f"   -> Prueba extra {i}/3 (latencia)...")
                    ok, lat_extra = hacer_ping(ip)
                    if not ok:
                        fallos_por_latencia += 1
                        print("      Resultado: FALLÓ (no respondió)")
                    else:
                        if lat_extra is None:
                            print("      Resultado: OK (latencia N/D)")
                        else:
                            print(f"      Resultado: OK | latencia: {lat_extra:.1f} ms")
                            if lat_extra > LATENCIA_UMBRAL:
                                fallos_por_latencia += 1
                                print(f"      (Cuenta como FALLA por latencia > {LATENCIA_UMBRAL} ms)")

                    if i < 3:
                        time.sleep(5)  # Espera de 5 segundos entre intentos

                fin_confirmacion_lat = datetime.now()
                tiempo_total_lat = (fin_confirmacion_lat - inicio_confirmacion_lat).total_seconds()
                print(f"[Confirmación Latencia] Fallos/altas: {fallos_por_latencia}/3 | Tiempo total comprobación: {tiempo_total_lat:.1f} seg")

                if fallos_por_latencia >= 2:
                    print(f"[Confirmación Latencia] Latencia ALTA confirmada en {nombre}. Ejecutando speedtest y enviando alerta.")
                    if not latencia_alta_activa[nombre]:
                        latencia_alta_activa[nombre] = True
                        inicio_latencia_alta[nombre] = ahora
                        descarga, subida, _, _ = medir_speedtest_ookla()
                        mensaje = (f"⚠️ *{nombre} tiene ALTA LATENCIA:* {latencia:.1f} ms (alerta confirmada)\n"
                                   f"📅 {ahora.strftime('%d-%m-%Y %H:%M:%S')}\n"
                                   f"🌐 *IP:* {ip}\n"
                                   f"⏳ *Inicio latencia alta:* {inicio_latencia_alta[nombre].strftime('%d-%m-%Y %H:%M:%S')}\n"
                                   f"📈 *Descarga:* {descarga or 'Error'} Mbps\n"
                                   f"📤 *Subida:* {subida or 'Error'} Mbps")
                        if hay_internet():
                            enviar_whatsapp(mensaje, nombre, "latencia_alta")
                        # Log problema latencia alta
                        log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | LATENCIA ALTA | Latencia: {latencia:.1f} ms")
                else:
                    print(f"[Confirmación Latencia] Latencia alta en {nombre} no se confirma (menos de 2/3). No se envía alerta.")

            # =========================
            # FIN de latencia alta
            # =========================
            elif latencia_alta_activa[nombre] and latencia is not None and latencia <= LATENCIA_UMBRAL:
                print(f"[Evento] FIN de latencia alta en {nombre}")
                fin_latencia = ahora
                descarga, subida, _, _ = medir_speedtest_ookla()
                duracion_latencia_str = str(fin_latencia - inicio_latencia_alta[nombre]).split('.')[0]
                mensaje = (f"✅ *{nombre} latencia ALTA finalizada*\n"
                           f"🌐 *IP:* {ip}\n"
                           f"⏳ *Inicio latencia alta:* {inicio_latencia_alta[nombre].strftime('%d-%m-%Y %H:%M:%S')}\n"
                           f"🕒 *Fin latencia alta:* {fin_latencia.strftime('%d-%m-%Y %H:%M:%S')}\n"
                           f"⏳ *Duración de latencia alta:* {duracion_latencia_str}\n"
                           f"⚡ *Latencia actual:* {latencia:.1f} ms\n"
                           f"📈 *Descarga:* {descarga or 'Error'} Mbps\n"
                           f"📤 *Subida:* {subida or 'Error'} Mbps")
                if hay_internet():
                    enviar_whatsapp(mensaje, nombre, "latencia_fin")
                # Log problema fin latencia alta
                log_problemas(nombre, f"{ahora.strftime('%d-%m-%Y %H:%M:%S')} | {nombre} | FIN LATENCIA ALTA | Latencia: {latencia:.1f} ms")

                latencia_alta_activa[nombre] = False
                inicio_latencia_alta[nombre] = None

            estado_anterior[nombre] = estado

        print(f"\n[{datetime.now().strftime('%d-%m-%Y %H:%M:%S')}] Fin de ciclo. Esperando {INTERVALO_MINUTOS} minuto(s)...")
        for i in range(INTERVALO_MINUTOS * 60):
            print(f"Esperando {i+1} segundos antes del siguiente ciclo...", end='\r', flush=True)
            time.sleep(1)
        print()

if __name__ == "__main__":
    main()