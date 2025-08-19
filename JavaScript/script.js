const SERVIDORES = [
    "google.com",
    "viaz-merweb1",
    "viaz-merdb1",
    "hqaz-merwebprd1",
    "hqaz-merdbprd1",
    "hqaz-mesdb1"
];

const selectServidor = document.getElementById("selector-servidor");
const container = document.getElementById("dashboard-container");

let chartStatus = null;
let chartProblemas = null;

// Datos crudos para status y problemas (se mantienen completos)
let datosStatusCompletos = [];
let datosProblemasCompletos = [];

// Guardar filtros globales y páginas actuales para status y problemas
let filtrosStatus = { fecha: "", hora: "" };
let filtrosProblemas = { fecha: "", hora: "" };
let paginaStatus = 1;
let paginaProblemas = 1;

function cargarOpciones() {
    SERVIDORES.forEach(s => {
        const option = document.createElement("option");
        option.value = s;
        option.textContent = s.toUpperCase();
        selectServidor.appendChild(option);
    });
}

// =====================
// Manejo de semanas
// =====================

function getFechaInicioSemana(d) {
    const dia = d.getDay() || 7;
    const inicio = new Date(d);
    inicio.setDate(d.getDate() - (dia - 1));
    return inicio;
}

function getFechaFinSemana(inicio) {
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 6);
    return fin;
}

function formatDateSpan(d) {
    const meses = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];
    let dia = d.getDate();
    let mes = meses[d.getMonth()];
    return `${dia.toString().padStart(2, '0')}_${mes}`;
}

// Genera todas las semanas desde el 11 agosto 2025 hasta hoy
function generarSemanasDesde(inicio) {
    const hoy = new Date();
    const semanas = [];

    let cursor = new Date(inicio);
    while (cursor <= hoy) {
        const inicioSemana = new Date(cursor);
        const finSemana = getFechaFinSemana(inicioSemana);

        semanas.push({
            inicio: new Date(inicioSemana),
            fin: new Date(finSemana)
        });

        // Avanzar a la siguiente semana
        cursor.setDate(cursor.getDate() + 7);
    }
    return semanas;
}

// Genera nombre de archivo para una semana
function generarNombreArchivoPorSemana(tipo, servidor, inicio, fin) {
    return `${servidor}/${tipo}_red_${formatDateSpan(inicio)}_al_${formatDateSpan(fin)}_${fin.getFullYear()}.txt`.toLowerCase();
}

// =====================
// Carga y parseo de archivos
// =====================

function parseLinea(linea, tipoArchivo) {
    const partes = linea.split("|").map(s => s.trim());
    if (partes.length < 4) return null;

    let fechaHora, servidor, estado;

    if (tipoArchivo === "status") {
        fechaHora = partes[0];
        servidor = partes[1];
        estado = partes[2];
    } else if (tipoArchivo === "problemas") {
        fechaHora = partes[0];
        estado = partes[1];
        servidor = partes[2];
    } else {
        fechaHora = partes[0];
        servidor = partes[1];
        estado = partes[2];
    }

    let latencia = null;
    if (partes[3].toLowerCase().includes("latencia:")) {
        let latStr = partes[3]
            .toLowerCase()
            .replace("latencia:", "")
            .replace("ms", "")
            .trim();
        latencia = parseFloat(latStr);
        if (isNaN(latencia)) latencia = null;
    }

    return {
        fecha: fechaHora,
        servidor: servidor,
        estado: estado,
        latencia: latencia
    };
}

async function cargarArchivoTxt(ruta, tipoArchivo) {
    try {
        const response = await fetch(ruta + "?t=" + Date.now());
        if (!response.ok) throw new Error("No se pudo cargar " + ruta);
        const text = await response.text();
        const lineas = text.split("\n").filter(l => l.trim() !== "");
        return lineas.map(l => parseLinea(l, tipoArchivo)).filter(x => x !== null);
    } catch (e) {
        console.warn(e);
        return [];
    }
}

// =====================
// Ordenamiento y filtrado
// =====================

function ordenarPorFechaDesc(datos) {
    return datos.slice().sort((a, b) => {
        const fechaA = new Date(a.fecha.split(" ")[0].split("-").reverse().join("-") + " " + (a.fecha.split(" ")[1] || "00:00:00"));
        const fechaB = new Date(b.fecha.split(" ")[0].split("-").reverse().join("-") + " " + (b.fecha.split(" ")[1] || "00:00:00"));
        return fechaB - fechaA;
    });
}

function ordenarPorFechaAsc(datos) {
    return datos.slice().sort((a, b) => {
        const fechaA = new Date(a.fecha.split(" ")[0].split("-").reverse().join("-") + " " + (a.fecha.split(" ")[1] || "00:00:00"));
        const fechaB = new Date(b.fecha.split(" ")[0].split("-").reverse().join("-") + " " + (b.fecha.split(" ")[1] || "00:00:00"));
        return fechaA - fechaB;
    });
}

function filtrarDatos(datos, fechaFiltro, horaFiltro) {
    return datos.filter(d => {
        let coincide = true;
        if (fechaFiltro) {
            coincide = coincide && d.fecha.startsWith(fechaFiltro.split("-").reverse().join("-"));
        }
        if (horaFiltro) {
            const horaDato = (d.fecha.split(" ")[1] || "00:00:00").split(":")[0];
            coincide = coincide && parseInt(horaDato, 10) === parseInt(horaFiltro, 10);
        }
        return coincide;
    });
}

// =====================
// Cargar todas las semanas
// =====================

async function cargarTodasLasSemanas(servidor) {
    const inicioReferencia = new Date(2025, 7, 11); // 11 de agosto 2025
    const semanas = generarSemanasDesde(inicioReferencia);

    let datosStatus = [];
    let datosProblemas = [];

    for (let semana of semanas) {
        const archivoStatus = generarNombreArchivoPorSemana("status", servidor, semana.inicio, semana.fin);
        const archivoProblemas = generarNombreArchivoPorSemana("problemas", servidor, semana.inicio, semana.fin);

        const datosS = await cargarArchivoTxt(archivoStatus, "status");
        const datosP = await cargarArchivoTxt(archivoProblemas, "problemas");

        datosStatus = datosStatus.concat(datosS);
        datosProblemas = datosProblemas.concat(datosP);
    }

    datosStatusCompletos = ordenarPorFechaAsc(datosStatus);
    datosProblemasCompletos = ordenarPorFechaAsc(datosProblemas);
}

function mostrarModalExportacion(tipo, servidor) {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.5)";
    overlay.style.display = "flex";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";
    overlay.style.zIndex = "9999";

    const modal = document.createElement("div");
    modal.classList.add("export-modal");
    modal.style.padding = "20px";
    modal.style.borderRadius = "8px";
    modal.style.minWidth = "300px";
    modal.innerHTML = `
        <h3>Exportar ${tipo.toUpperCase()}</h3>
        <label>Fecha inicio:</label><br>
        <input type="date" id="fecha-inicio-export" class="modal-input" /><br>
        <label>Hora inicio (HH):</label><br>
        <input type="number" min="0" max="23" id="hora-inicio-export" placeholder="0-23" class="modal-input" /><br><br>
        <label>Fecha fin:</label><br>
        <input type="date" id="fecha-fin-export" class="modal-input" /><br>
        <label>Hora fin (HH):</label><br>
        <input type="number" min="0" max="23" id="hora-fin-export" placeholder="0-23" class="modal-input" /><br><br>
        <button id="btn-confirm-export" class="modal-btn confirm">Exportar</button>
        <button id="btn-cancel-export" class="modal-btn cancel">Cancelar</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    if (document.body.classList.contains('dark-mode')) {
        modal.classList.add('dark-mode');
    }

    document.getElementById("btn-cancel-export").addEventListener("click", () => {
        document.body.removeChild(overlay);
    });

    document.getElementById("btn-confirm-export").addEventListener("click", () => {
        const fechaInicio = document.getElementById("fecha-inicio-export").value;
        const horaInicio = document.getElementById("hora-inicio-export").value;
        const fechaFin = document.getElementById("fecha-fin-export").value;
        const horaFin = document.getElementById("hora-fin-export").value;

        const datosFiltrados = filtrarDatosPorRango(
            tipo === "status" ? datosStatusCompletos : datosProblemasCompletos,
            fechaInicio, horaInicio, fechaFin, horaFin
        );

        exportarExcel(datosFiltrados, tipo, servidor);
        document.body.removeChild(overlay);
    });
}

function filtrarDatosPorRango(datos, fechaInicio, horaInicio, fechaFin, horaFin) {
    const inicio = fechaInicio
        ? Date.UTC(
            ...fechaInicio.split("-").map((n, i) => i === 1 ? n - 1 : +n),
            +(horaInicio?.padStart(2, "0") || 0), 0, 0
        )
        : null;

    const fin = fechaFin
        ? Date.UTC(
            ...fechaFin.split("-").map((n, i) => i === 1 ? n - 1 : +n),
            +(horaFin?.padStart(2, "0") || 23), 59, 59
        )
        : null;

    return datos.filter(d => {
        const [fecha, hora] = d.fecha.split(" ");
        const [dia, mes, anio] = fecha.split("-").map(n => +n);
        const [hh, mm, ss] = (hora || "00:00:00").split(":").map(n => +n);
        const fechaDato = Date.UTC(anio, mes - 1, dia, hh, mm, ss);

        if (inicio && fechaDato < inicio) return false;
        if (fin && fechaDato > fin) return false;
        return true;
    });
}

function formatearFecha(fechaOriginal) {
    const [fecha, hora] = fechaOriginal.split(" ");
    const [dia, mes, anio] = fecha.split("-");
    return `${mes}/${dia}/${anio} ${hora}`;
}

function exportarExcel(datos, tipo, servidor) {
    if (!datos || datos.length === 0) {
        alert("No hay datos para exportar.");
        return;
    }

    const ws_data = [
        ["Fecha", "Servidor", "Estado", "Latencia (ms)"],
        ...datos.map(d => [
            formatearFecha(d.fecha),
            d.servidor,
            d.estado,
            d.latencia !== null ? d.latencia : ""
        ])
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo.toUpperCase());
    XLSX.writeFile(wb, `${servidor}_${tipo}_export.xlsx`);
}



// Función principal para crear la tabla con filtros y paginación
function crearTablaConFiltros(datosCompletos, contenedor, tipo, onFiltrar) {
    contenedor.innerHTML = "";

    let datosFiltrados = ordenarPorFechaDesc(datosCompletos); // ordenar desde el inicio
    let paginaActual = tipo === "status" ? paginaStatus : paginaProblemas;
    const filasPorPagina = 10;

    // Helper para parsear fechas "DD-MM-YYYY HH:MM:SS"
    function parseFechaFlexible(fechaStr) {
        if (fechaStr instanceof Date) return fechaStr;
        const str = String(fechaStr).trim();
        const m = str.match(/^(\d{2})-(\d{2})-(\d{4})[ ]?(\d{2}):(\d{2}):(\d{2})$/);
        if (m) {
            const [, dd, MM, yyyy, hh, mm, ss] = m;
            return new Date(Number(yyyy), Number(MM) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
        }
        return new Date(str);
    }

    // Filtra datos según minutos exactos desde ahora hacia atrás
    function filtrarPorRango(datos, minutos) {
        const ahora = new Date();
        const limite = new Date(ahora.getTime() - minutos * 60 * 1000);

        return datos.filter(d => {
            const f = parseFechaFlexible(d.fecha);
            if (!(f instanceof Date) || isNaN(f)) return false;
            return f >= limite && f <= ahora;
        });
    }

    const filtrosDiv = document.createElement("div");
    filtrosDiv.classList.add("filtros-container");
    filtrosDiv.style.display = "flex";
    filtrosDiv.style.alignItems = "center";
    filtrosDiv.style.gap = "10px"; // Espacio entre los elementos

    // Fecha
    const fechaLabel = document.createElement("label");
    fechaLabel.setAttribute("for", `fecha-${tipo}`);
    fechaLabel.textContent = "Fecha:";
    filtrosDiv.appendChild(fechaLabel);

    const fechaInput = document.createElement("input");
    fechaInput.type = "date";
    fechaInput.id = `fecha-${tipo}`;
    fechaInput.classList.add("filtro-input");
    fechaInput.value = tipo === "status" ? filtrosStatus.fecha : filtrosProblemas.fecha;
    filtrosDiv.appendChild(fechaInput);

    // Hora
    const horaLabel = document.createElement("label");
    horaLabel.setAttribute("for", `hora-${tipo}`);
    horaLabel.textContent = "Hora (HH):";
    filtrosDiv.appendChild(horaLabel);

    const horaInput = document.createElement("input");
    horaInput.type = "number";
    horaInput.min = 0;
    horaInput.max = 23;
    horaInput.id = `hora-${tipo}`;
    horaInput.classList.add("filtro-input", "hora-input");
    horaInput.value = tipo === "status" ? filtrosStatus.hora : filtrosProblemas.hora;
    horaInput.placeholder = "0-23";
    filtrosDiv.appendChild(horaInput);

    // Rango rápido
    const rangoLabel = document.createElement("label");
    rangoLabel.setAttribute("for", `rango-${tipo}`);
    rangoLabel.textContent = "Rango:";
    filtrosDiv.appendChild(rangoLabel);

    const rangoSelect = document.createElement("select");
    rangoSelect.id = `rango-${tipo}`;
    rangoSelect.classList.add("rango-select");

    const opcionesRango = [
        { txt: "— Rango rápido —", min: "" },
        { txt: "Última media hora", min: 30 },
        { txt: "Última hora", min: 60 },
        { txt: "Últimas 4 horas", min: 240 },
        { txt: "Últimas 8 horas", min: 480 },
        { txt: "Últimas 16 horas", min: 960 },
        { txt: "Último día", min: 1440 },
        { txt: "Última semana", min: 10080 },
    ];
    opcionesRango.forEach(o => {
        const opt = document.createElement("option");
        opt.value = o.min;
        opt.textContent = o.txt;
        rangoSelect.appendChild(opt);
    });
    filtrosDiv.appendChild(rangoSelect);

    // Botón Limpiar filtros
    const btnLimpiar = document.createElement("button");
    btnLimpiar.classList.add("clear-filters");
    btnLimpiar.id = `clear-${tipo}`;
    btnLimpiar.textContent = "Limpiar filtros";
    btnLimpiar.style.padding = "8px 16px";
    btnLimpiar.style.backgroundColor = "#802424ff";
    btnLimpiar.style.border = "none";
    btnLimpiar.style.borderRadius = "6px";
    btnLimpiar.style.cursor = "pointer";
    btnLimpiar.style.fontWeight = "bold";
    btnLimpiar.style.transition = "background-color 0.2s";
    btnLimpiar.addEventListener("mouseenter", () => btnLimpiar.style.backgroundColor = "#cc1616ff");
    btnLimpiar.addEventListener("mouseleave", () => btnLimpiar.style.backgroundColor = "#802424ff");
    filtrosDiv.appendChild(btnLimpiar);

    // Botón Exportar Excel
    const btnExport = document.createElement("button");
    btnExport.textContent = "Exportar Excel";
    btnExport.style.padding = "8px 16px";
    btnExport.style.backgroundColor = "#1d5981ff";
    btnExport.style.color = "#fff";
    btnExport.style.border = "none";
    btnExport.style.borderRadius = "6px";
    btnExport.style.cursor = "pointer";
    btnExport.style.fontWeight = "bold";
    btnExport.style.transition = "background-color 0.2s";
    btnExport.addEventListener("mouseenter", () => btnExport.style.backgroundColor = "#1873b0ff");
    btnExport.addEventListener("mouseleave", () => btnExport.style.backgroundColor = "#1d5981ff");
    filtrosDiv.appendChild(btnExport);

    // Agregar filtrosDiv al contenedor principal
    contenedor.appendChild(filtrosDiv);


    const tablaDiv = document.createElement("div");
    contenedor.appendChild(tablaDiv);

    const paginacionDiv = document.createElement("div");
    paginacionDiv.style.marginTop = "10px";
    paginacionDiv.style.textAlign = "center";
    contenedor.appendChild(paginacionDiv);

    function formatearFecha(fecha) {
        const f = parseFechaFlexible(fecha);
        if (!(f instanceof Date) || isNaN(f)) return fecha;
        const MM = String(f.getMonth() + 1).padStart(2, '0');
        const DD = String(f.getDate()).padStart(2, '0');
        const YYYY = f.getFullYear();
        const hh = String(f.getHours()).padStart(2, '0');
        const mm = String(f.getMinutes()).padStart(2, '0');
        const ss = String(f.getSeconds()).padStart(2, '0');
        return `${MM}/${DD}/${YYYY} ${hh}:${mm}:${ss}`;
    }


    function mostrarPagina(pag) {
        paginaActual = pag;
        tablaDiv.innerHTML = "";

        // Ordenar antes de paginar
        datosFiltrados = ordenarPorFechaDesc(datosFiltrados);

        const start = (paginaActual - 1) * filasPorPagina;
        const end = start + filasPorPagina;
        const datosPagina = datosFiltrados.slice(start, end);

        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        ["Fecha/Hora", "Servidor", "Estado", "Latencia (ms)"].forEach(h => {
            const th = document.createElement("th");
            th.textContent = h;
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        datosPagina.forEach(d => {
            const tr = document.createElement("tr");

            const tdFecha = document.createElement("td");
            tdFecha.textContent = formatearFecha(d.fecha);

            tr.appendChild(tdFecha);

            const tdServidor = document.createElement("td");
            tdServidor.textContent = d.servidor;
            tr.appendChild(tdServidor);

            const tdEstado = document.createElement("td");
            tdEstado.textContent = d.estado;
            tr.appendChild(tdEstado);

            const tdLatencia = document.createElement("td");
            tdLatencia.textContent = d.latencia !== null ? d.latencia.toFixed(0) : "N/D";
            if (d.latencia !== null) {
                tr.classList.add(d.latencia > 120 ? "latencia-alta" : "latencia-buena");
            }
            tr.appendChild(tdLatencia);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        tablaDiv.appendChild(table);

        paginacionDiv.innerHTML = "";
        const totalPaginas = Math.ceil(datosFiltrados.length / filasPorPagina);

        // Botón anterior
        const btnAnterior = document.createElement("button");
        btnAnterior.textContent = "←";
        btnAnterior.classList.add("paginacion-btn");
        if (paginaActual === 1) btnAnterior.classList.add("disabled");
        btnAnterior.addEventListener("click", () => mostrarPagina(paginaActual - 1));

        // Botón siguiente
        const btnSiguiente = document.createElement("button");
        btnSiguiente.textContent = "→";
        btnSiguiente.classList.add("paginacion-btn");
        if (paginaActual === totalPaginas || totalPaginas === 0) btnSiguiente.classList.add("disabled");
        btnSiguiente.addEventListener("click", () => mostrarPagina(paginaActual + 1));

        // Info de página
        const info = document.createElement("span");
        info.classList.add("paginacion-info");
        info.textContent = `  Página ${paginaActual} de ${totalPaginas}  `;

        // Añadir al contenedor
        paginacionDiv.appendChild(btnAnterior);
        paginacionDiv.appendChild(info);
        paginacionDiv.appendChild(btnSiguiente);

    }

    // ---- Aplica filtros por fecha/hora (y maneja habilitar/deshabilitar rango rápido)
    function aplicarFiltros() {
        const fechaElem = document.getElementById(`fecha-${tipo}`);
        const horaElem = document.getElementById(`hora-${tipo}`);
        const fechaInput = fechaElem.value;
        const horaInput = horaElem.value;

        // Habilita/deshabilita rango rápido dependiendo de si hay filtros
        const hayFiltrosFechaHora = !!(fechaInput || horaInput);
        rangoSelect.disabled = hayFiltrosFechaHora;
        rangoSelect.title = hayFiltrosFechaHora ? "Deshabilitado porque hay filtros de fecha/hora activos" : "";

        if (tipo === "status") {
            filtrosStatus.fecha = fechaInput;
            filtrosStatus.hora = horaInput;
        } else {
            filtrosProblemas.fecha = fechaInput;
            filtrosProblemas.hora = horaInput;
        }

        // Si hay filtros de fecha/hora -> usar filtrarDatos existente
        if (hayFiltrosFechaHora) {
            datosFiltrados = filtrarDatos(datosCompletos, fechaInput, horaInput);
        } else {
            // Si NO hay filtros de fecha/hora y hay rango seleccionado -> aplicar rango
            if (rangoSelect.value) {
                const minutos = Number(rangoSelect.value);
                datosFiltrados = filtrarPorRango(datosCompletos, minutos);
            } else {
                // Sin filtros y sin rango: mostrar todo
                datosFiltrados = datosCompletos.slice();
            }
        }

        datosFiltrados = ordenarPorFechaDesc(datosFiltrados); // ordenar después de filtrar

        paginaActual = 1;
        mostrarPagina(paginaActual);
        onFiltrar(datosFiltrados);
    }

    // Eventos de filtros
    document.getElementById(`fecha-${tipo}`).addEventListener("change", aplicarFiltros);
    document.getElementById(`hora-${tipo}`).addEventListener("change", aplicarFiltros);

    // Evento rango rápido (solo aplica si NO hay fecha/hora)
    rangoSelect.addEventListener("change", () => {
        const fechaVal = document.getElementById(`fecha-${tipo}`).value;
        const horaVal = document.getElementById(`hora-${tipo}`).value;
        if (fechaVal || horaVal) return; // ignorar si hay filtros activos

        if (!rangoSelect.value) {
            // Sin rango -> mostrar todo
            datosFiltrados = ordenarPorFechaDesc(datosCompletos.slice());
        } else {
            const minutos = Number(rangoSelect.value);
            datosFiltrados = ordenarPorFechaDesc(filtrarPorRango(datosCompletos, minutos));
        }

        paginaActual = 1;
        mostrarPagina(paginaActual);
        onFiltrar(datosFiltrados);
    });

    // Evento limpiar filtros
    document.getElementById(`clear-${tipo}`).addEventListener("click", () => {
        document.getElementById(`fecha-${tipo}`).value = "";
        document.getElementById(`hora-${tipo}`).value = "";
        rangoSelect.selectedIndex = 0;
        aplicarFiltros(); // esto re-habilita el select
        // Si hay un rango seleccionado, aplícalo
        if (rangoSelect.value) {
            rangoSelect.dispatchEvent(new Event("change"));
        }
    });

    btnExport.addEventListener("click", () => {
        mostrarModalExportacion(tipo, selectServidor.value);
    });

    // Estado inicial del rango (habilitar/deshabilitar según valores actuales)
    (function initRango() {
        const f = document.getElementById(`fecha-${tipo}`).value;
        const h = document.getElementById(`hora-${tipo}`).value;
        const hayFiltros = !!(f || h);
        rangoSelect.disabled = hayFiltros;
        rangoSelect.title = hayFiltros ? "Deshabilitado porque hay filtros de fecha/hora activos" : "";
    })();

    // Render inicial
    mostrarPagina(paginaActual);
    onFiltrar(datosFiltrados);

    return {
        actualizarDatos: (nuevosDatos) => {
            const fechaVal = document.getElementById(`fecha-${tipo}`).value;
            const horaVal = document.getElementById(`hora-${tipo}`).value;
            const hayFiltros = !!(fechaVal || horaVal);

            if (hayFiltros) {
                datosFiltrados = filtrarDatos(
                    nuevosDatos,
                    tipo === "status" ? filtrosStatus.fecha : filtrosProblemas.fecha,
                    tipo === "status" ? filtrosStatus.hora : filtrosProblemas.hora
                );
            } else if (rangoSelect.value) {
                // Respetar rango rápido cuando no hay filtros
                datosFiltrados = filtrarPorRango(nuevosDatos, Number(rangoSelect.value));
            } else {
                datosFiltrados = nuevosDatos.slice();
            }

            datosFiltrados = ordenarPorFechaDesc(datosFiltrados); // ordenar antes de mostrar
            const totalPaginas = Math.ceil(datosFiltrados.length / filasPorPagina);
            if (paginaActual > totalPaginas && totalPaginas > 0) paginaActual = totalPaginas;
            else if (totalPaginas === 0) paginaActual = 1;

            mostrarPagina(paginaActual);
            onFiltrar(datosFiltrados);
            if (tipo === "status") paginaStatus = paginaActual;
            else paginaProblemas = paginaActual;
        }
    };
}

// Reemplaza tu función por esta versión
function agruparDatos(datos, maxPuntos = 50) {
    if (!Array.isArray(datos) || datos.length === 0) return [];

    // Asegura orden por fecha real, no por string
    const ordenados = [...datos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    // Normaliza latencia: soporta number, string numérico o null
    const toNumber = (v) => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    // Si no se requiere agrupar, solo normaliza latencias
    if (ordenados.length <= maxPuntos) {
        return ordenados.map(d => {
            const n = toNumber(d.latencia);
            return { fecha: d.fecha, latencia: n === null ? null : Math.round(n) };
        });
    }

    const minT = new Date(ordenados[0].fecha).getTime();
    const maxT = new Date(ordenados[ordenados.length - 1].fecha).getTime();
    const rango = maxT - minT;

    // Fallback: si rango no es válido (por parsing o todas las fechas iguales),
    // hacemos un downsample por bloques pero ANCLADO al inicio (estable) y
    // conservando primer/último punto.
    if (!Number.isFinite(rango) || rango <= 0) {
        const size = Math.ceil(ordenados.length / maxPuntos);
        const res = [];
        for (let i = 0; i < ordenados.length; i += size) {
            const grupo = ordenados.slice(i, i + size);
            const vals = grupo.map(g => toNumber(g.latencia)).filter(v => v !== null);
            const lat = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
            // Usamos la fecha del PRIMER elemento del grupo para que el primer día nunca desaparezca
            res.push({ fecha: grupo[0].fecha, latencia: lat });
        }
        // Asegura incluir el último punto si no cayó en el último bloque representado
        const ultimoOrig = ordenados[ordenados.length - 1];
        if (res[res.length - 1].fecha !== ultimoOrig.fecha) {
            const n = toNumber(ultimoOrig.latencia);
            res.push({ fecha: ultimoOrig.fecha, latencia: n === null ? null : Math.round(n) });
        }
        return res;
    }

    // ---- Agrupación por intervalos de tiempo estables ----
    // Usamos "maxPuntos" cubetas de tiempo entre minT y maxT.
    const bucketsCount = maxPuntos;
    const paso = Math.max(1, Math.floor(rango / bucketsCount)); // al menos 1ms

    const buckets = Array.from({ length: bucketsCount }, (_, i) => ({
        inicio: minT + i * paso,
        fin: i === bucketsCount - 1 ? (maxT + 1) : (minT + (i + 1) * paso),
        items: []
    }));

    // Asignación en una pasada (O(n))
    for (const d of ordenados) {
        const t = new Date(d.fecha).getTime();
        if (!Number.isFinite(t)) continue; // ignora fechas inválidas
        const idx = Math.min(bucketsCount - 1, Math.max(0, Math.floor((t - minT) / paso)));
        buckets[idx].items.push(d);
    }

    const salida = buckets.map(b => {
        if (b.items.length === 0) {
            // Mantén el punto para estabilidad visual (null), etiqueta centrada en el intervalo
            const mid = new Date((b.inicio + b.fin) / 2).toISOString();
            return { fecha: mid, latencia: null };
        } else {
            const vals = b.items.map(x => toNumber(x.latencia)).filter(v => v !== null);
            const lat = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
            // Etiqueta: primera fecha real del bucket para que no "brinque" con nuevos datos
            return { fecha: b.items[0].fecha, latencia: lat };
        }
    });

    // Garantiza que los extremos coincidan con los originales
    if (salida.length > 0) {
        if (salida[0].fecha !== ordenados[0].fecha) salida[0].fecha = ordenados[0].fecha;
        const lastIdx = salida.length - 1;
        if (salida[lastIdx].fecha !== ordenados[ordenados.length - 1].fecha) {
            salida[lastIdx].fecha = ordenados[ordenados.length - 1].fecha;
        }
    }

    return salida;
}


// Crear la gráfica adaptativa
function crearGrafica(ctx, datos, titulo) {
    const datosOrdenados = ordenarPorFechaAsc(datos);

    // Detectamos rango total en milisegundos
    const tiempoTotal = new Date(datosOrdenados[datosOrdenados.length - 1].fecha) - new Date(datosOrdenados[0].fecha);

    // Decidir si agrupamos o no
    const datosParaGraficar = (tiempoTotal <= 60 * 60 * 1000) // <= 1 hora
        ? datosOrdenados
        : agruparDatos(datosOrdenados, 50);

    const etiquetas = datosParaGraficar.map(d => d.fecha);
    const latencias = datosParaGraficar.map(d => d.latencia === null ? null : Math.round(d.latencia));


    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: etiquetas,
            datasets: [{
                label: 'Latencia (ms)',
                data: latencias,
                fill: false,
                borderColor: '#27ae60',
                borderWidth: 2,
                pointRadius: 5,
                pointBackgroundColor: function (context) {
                    const value = context.raw;
                    if (value === null) return '#999';
                    return value > 120 ? '#e74c3c' : '#27ae60';
                },
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { labels: { font: { size: 14 } } },
                title: { display: true, text: titulo, font: { size: 16, weight: 'bold' } },
                tooltip: { callbacks: { label: ctx => ctx.raw === null ? "N/D" : ctx.raw + " ms" } }
            },
            scales: {
                x: { ticks: { maxRotation: 90, minRotation: 45, maxTicksLimit: 12 } },
                y: { suggestedMin: 0, suggestedMax: 250 }
            }
        }
    });
}

// Actualizar gráfica existente de manera adaptativa
function actualizarGraficaExistente(chart, nuevosDatos) {
    if (!chart) return;

    const datosOrdenados = ordenarPorFechaAsc(nuevosDatos);
    const tiempoTotal = new Date(datosOrdenados[datosOrdenados.length - 1].fecha) - new Date(datosOrdenados[0].fecha);

    const datosParaGraficar = (tiempoTotal <= 60 * 60 * 1000)
        ? datosOrdenados
        : agruparDatos(datosOrdenados, 50);

    chart.data.labels = datosParaGraficar.map(d => d.fecha);
    chart.data.datasets[0].data = datosParaGraficar.map(d => d.latencia === null ? null : Math.round(d.latencia));
    chart.update();
}


async function renderServidor(servidor) {
    container.innerHTML = "";

    if (chartStatus) chartStatus.destroy();
    if (chartProblemas) chartProblemas.destroy();
    chartStatus = null;
    chartProblemas = null;

    const div = document.createElement("div");
    div.classList.add("server-section");

    const h2 = document.createElement("h2");
    h2.textContent = servidor.toUpperCase();
    div.appendChild(h2);

    const tabButtonsDiv = document.createElement("div");
    tabButtonsDiv.className = "tab-buttons";

    const btnStatus = document.createElement("button");
    btnStatus.textContent = "Status";
    btnStatus.classList.add("active");

    const btnProblemas = document.createElement("button");
    btnProblemas.textContent = "Problemas";

    tabButtonsDiv.appendChild(btnStatus);
    tabButtonsDiv.appendChild(btnProblemas);
    div.appendChild(tabButtonsDiv);

    const contStatus = document.createElement("div");
    const contProblemas = document.createElement("div");
    contProblemas.style.display = "none";

    div.appendChild(contStatus);
    div.appendChild(contProblemas);

    const mensajeCargando = document.createElement("p");
    mensajeCargando.id = "mensaje-cargando";
    mensajeCargando.textContent = "Cargando datos...";
    div.appendChild(mensajeCargando);

    container.appendChild(div);

    try {
        // 🔥 ahora cargamos TODAS las semanas
        await cargarTodasLasSemanas(servidor);

        // Igualar latencia en problemas si falta
        datosProblemasCompletos = datosProblemasCompletos.map(p => {
            if (p.latencia === null) {
                const match = datosStatusCompletos.find(
                    s => s.fecha === p.fecha && s.servidor === p.servidor && s.latencia !== null
                );
                if (match) return { ...p, latencia: match.latencia };
            }
            return p;
        });

        mensajeCargando.style.display = "none";

        // Crear tablas y gráficas iniciales
        const tablaStatusObj = crearTablaConFiltros(datosStatusCompletos, contStatus, "status", (filtrados) => {
            if (!chartStatus) {
                const nuevoCanvas = document.createElement("canvas");
                contStatus.appendChild(nuevoCanvas);
                chartStatus = crearGrafica(nuevoCanvas.getContext('2d'), filtrados, "Latencias Status");
            } else {
                actualizarGraficaExistente(chartStatus, filtrados);
            }
        });

        const tablaProblemasObj = crearTablaConFiltros(datosProblemasCompletos, contProblemas, "problemas", (filtrados) => {
            if (!chartProblemas) {
                const nuevoCanvas = document.createElement("canvas");
                contProblemas.appendChild(nuevoCanvas);
                chartProblemas = crearGrafica(nuevoCanvas.getContext('2d'), filtrados, "Latencias Problemas");
            } else {
                actualizarGraficaExistente(chartProblemas, filtrados);
            }
        });

        // Botones de pestaña
        btnStatus.addEventListener("click", () => {
            btnStatus.classList.add("active");
            btnProblemas.classList.remove("active");
            contStatus.style.display = "";
            contProblemas.style.display = "none";
            if (chartStatus) chartStatus.resize();
        });

        btnProblemas.addEventListener("click", () => {
            btnProblemas.classList.add("active");
            btnStatus.classList.remove("active");
            contStatus.style.display = "none";
            contProblemas.style.display = "";
            if (chartProblemas) chartProblemas.resize();
        });

        // Actualización periódica sin destruir gráficas
        async function actualizarDatosSolo() {
            try {
                // volvemos a recargar todas las semanas
                await cargarTodasLasSemanas(servidor);

                // Igualar latencia en problemas
                datosProblemasCompletos = datosProblemasCompletos.map(p => {
                    if (p.latencia === null) {
                        const match = datosStatusCompletos.find(
                            s => s.fecha === p.fecha && s.servidor === p.servidor && s.latencia !== null
                        );
                        if (match) return { ...p, latencia: match.latencia };
                    }
                    return p;
                });

                // Actualizar tabla y gráficas sin recrearlas
                tablaStatusObj.actualizarDatos(datosStatusCompletos);
                tablaProblemasObj.actualizarDatos(datosProblemasCompletos);

            } catch (e) {
                console.warn("Error al actualizar datos:", e);
            }
        }

        setInterval(actualizarDatosSolo, 60000);

    } catch (error) {
        mensajeCargando.textContent = "Error al cargar datos.";
        console.error(error);
    }
}

cargarOpciones();

selectServidor.addEventListener("change", () => {
    if (selectServidor.value) {
        renderServidor(selectServidor.value);
    } else {
        container.innerHTML = "";
    }
});
