// backend/static/script.js (Versión con Análisis Comparativo y Promedio Móvil)

// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
const API_URL = ''; 
let todasLasEstaciones = [];
let datosDeCalidad = [];
let estacionesSeleccionadas = new Set();
let mapa;
let grafico;
let graficoReconstruccion;
let graficoComparativo; // Nuevo: para el gráfico de comparación
let exploradorDatepicker;
let reconDatepicker;
let datosGraficoActual = [];

const MAX_SELECCION = 3;
const CHART_COLORS = ['#4A90E2', '#F5A623', '#417505', '#BD10E0', '#9013FE'];

const VARIABLE_NOMBRES = {
    "precipitacion": "Precipitación",
    "temperatura": "Temperatura",
    "nivelAgua": "Nivel de Agua"
};

// --- INICIALIZACIÓN DE LA APLICACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    inicializarMapa();
    cargarEstaciones();
    setupNavigation();
    inicializarDatepickers();
    setupExportButtons();
});

// --- LÓGICA DE NAVEGACIÓN ---
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const pageSections = document.querySelectorAll('.page-section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetId = `section-${link.id.split('-')[1]}`;
            pageSections.forEach(section => section.classList.add('hidden'));
            navLinks.forEach(nav => {
                nav.classList.remove('active', 'text-indigo-600');
                nav.classList.add('text-slate-600');
            });

            document.getElementById(targetId).classList.remove('hidden');
            link.classList.add('active', 'text-indigo-600');
            link.classList.remove('text-slate-600');

            if (targetId === 'section-calidad' && datosDeCalidad.length === 0) cargarCalidadDatos();
            if (targetId === 'section-reconstruccion' && todasLasEstaciones.length > 0) inicializarSeccionReconstruccion();
            if (targetId === 'section-narrativas') inicializarSeccionNarrativas();
            if (targetId === 'section-comparativo' && todasLasEstaciones.length > 0) inicializarSeccionComparativo();
        });
    });
}

// --- SECCIÓN 1: EXPLORADOR DE DATOS ---
function inicializarMapa() {
    if (document.getElementById('map')) {
        mapa = L.map('map').setView([-0.22985, -78.52498], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(mapa);
    }
}
async function cargarEstaciones() {
    try {
        const response = await fetch(`${API_URL}/api/estaciones`);
        if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);
        const jsonData = await response.json();
        if (!Array.isArray(jsonData)) throw new Error("La respuesta no es un array.");
        todasLasEstaciones = jsonData;
        document.getElementById('variable-select').addEventListener('change', handleVariableChange);
        document.getElementById('suavizar-checkbox').addEventListener('change', actualizarGrafico);
        actualizarVistaPorVariable();
    } catch (error) {
        console.error('Error al cargar las estaciones:', error);
        document.getElementById('station-list').innerHTML = '<p class="text-red-500">No se pudieron cargar las estaciones.</p>';
    }
}
function handleVariableChange() {
    estacionesSeleccionadas.clear();
    actualizarVistaPorVariable();
    actualizarGrafico();
}
function handleStationToggle(codigoEstacion) {
    if (estacionesSeleccionadas.has(codigoEstacion)) {
        estacionesSeleccionadas.delete(codigoEstacion);
    } else {
        if (estacionesSeleccionadas.size < MAX_SELECCION) {
            estacionesSeleccionadas.add(codigoEstacion);
        } else {
            alert(`Puedes seleccionar un máximo de ${MAX_SELECCION} estaciones.`);
            document.getElementById(`station-${codigoEstacion}`).checked = false;
        }
    }
    actualizarGrafico();
}
function actualizarVistaPorVariable() {
    const variableActual = document.getElementById('variable-select').value;
    mapa.eachLayer(layer => { if (layer instanceof L.Marker) mapa.removeLayer(layer); });
    const stationListDiv = document.getElementById('station-list');
    stationListDiv.innerHTML = '';
    const estacionesFiltradas = todasLasEstaciones.filter(est => est[variableActual]);
    if (estacionesFiltradas.length === 0) {
        stationListDiv.innerHTML = '<p class="text-gray-500">No hay estaciones para esta variable.</p>';
        return;
    }
    estacionesFiltradas.forEach(estacion => {
        const isChecked = estacionesSeleccionadas.has(estacion.codigo) ? 'checked' : '';
        const div = document.createElement('div');
        div.className = 'flex items-center mb-2';
        div.innerHTML = `<input type="checkbox" id="station-${estacion.codigo}" ${isChecked} onchange="handleStationToggle('${estacion.codigo}')" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"><label for="station-${estacion.codigo}" class="ml-2 block text-sm text-gray-900">${estacion.nombre} (${estacion.codigo})</label>`;
        stationListDiv.appendChild(div);
        const marker = L.marker([estacion.latitud, estacion.longitud]).addTo(mapa);
        marker.bindPopup(`<b>${estacion.nombre}</b><br>${estacion.codigo}`);
    });
}
async function actualizarGrafico() {
    const variableActual = document.getElementById('variable-select').value;
    const tituloGrafico = document.getElementById('chart-title');
    const loadingIndicator = document.getElementById('loading-indicator');
    const exportButtons = document.getElementById('export-buttons');
    const suavizar = document.getElementById('suavizar-checkbox').checked;
    const nombreBonito = VARIABLE_NOMBRES[variableActual] || "Datos";

    exportButtons.classList.add('hidden');
    datosGraficoActual = [];

    if (estacionesSeleccionadas.size === 0) {
        if (grafico) grafico.destroy();
        grafico = null;
        tituloGrafico.innerText = 'Gráfico de Datos';
        return;
    }

    loadingIndicator.classList.remove('hidden');
    tituloGrafico.innerText = `Cargando datos para ${nombreBonito}...`;
    const codigos = Array.from(estacionesSeleccionadas).join(',');
    
    const selectedDates = exploradorDatepicker.selectedDates;
    let url = `${API_URL}/api/datos?variable=${variableActual}&estaciones=${codigos}&suavizar=${suavizar}`;
    if (selectedDates.length === 2) {
        const fechaInicio = selectedDates[0].toISOString().split('T')[0];
        const fechaFin = selectedDates[1].toISOString().split('T')[0];
        url += `&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
    }

    try {
        const response = await fetch(url);
        const datos = await response.json();
        if (datos && datos.length > 0) {
            datosGraficoActual = datos;
            prepararYDibujarGrafico(datos, variableActual, suavizar);
            tituloGrafico.innerText = `Gráfico de ${nombreBonito}`;
            exportButtons.classList.remove('hidden');
        } else {
             tituloGrafico.innerText = 'No hay datos para las estaciones y fechas seleccionadas.';
             if (grafico) grafico.destroy();
        }
    } catch (error) {
        console.error('Error al cargar los datos del gráfico:', error);
        tituloGrafico.innerText = 'Error al cargar datos.';
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}
function prepararYDibujarGrafico(datos, variable, suavizar) {
    const ctx = document.getElementById('myChart').getContext('2d');
    const labels = datos.map(d => d.fecha);
    const nombreEjeY = VARIABLE_NOMBRES[variable] || variable;
    
    const datasets = [];
    Array.from(estacionesSeleccionadas).forEach((codigo, index) => {
        // Serie de datos original
        datasets.push({
            label: codigo,
            data: datos.map(d => d[codigo]),
            borderColor: CHART_COLORS[index % CHART_COLORS.length],
            backgroundColor: CHART_COLORS[index % CHART_COLORS.length] + '33',
            tension: 0.4,
            fill: false,
            spanGaps: true
        });
        // Serie de datos suavizada (si está activada)
        if (suavizar && datos[0][`${codigo}_suavizado`] !== undefined) {
            datasets.push({
                label: `${codigo} (Promedio Móvil)`,
                data: datos.map(d => d[`${codigo}_suavizado`]),
                borderColor: CHART_COLORS[index % CHART_COLORS.length],
                borderWidth: 2,
                borderDash: [5, 5], // Línea punteada
                pointRadius: 0, // Sin puntos
                fill: false,
            });
        }
    });

    if (grafico) grafico.destroy();
    grafico = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: nombreEjeY.toUpperCase() }}}, plugins: { legend: { position: 'top' }, title: { display: true, text: `Datos históricos para ${nombreEjeY}` }}}});
}

// --- SECCIÓN 2: ANÁLISIS DE CALIDAD ---
async function cargarCalidadDatos() {
    const tableBody = document.getElementById('calidad-table-body');
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-4">Cargando datos de calidad...</td></tr>';
    try {
        const response = await fetch(`${API_URL}/api/calidad-datos`);
        if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);
        const jsonData = await response.json();
        if (!Array.isArray(jsonData)) throw new Error("La respuesta no es un array.");
        datosDeCalidad = jsonData;
        renderCalidadTable(datosDeCalidad);
        document.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const sortKey = header.dataset.sort;
                sortCalidadTable(sortKey);
            });
        });
    } catch (error) {
        console.error('Error al cargar los datos de calidad:', error);
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-4 text-red-500">No se pudieron cargar los datos.</td></tr>';
    }
}
function renderCalidadTable(data) {
    const tableBody = document.getElementById('calidad-table-body');
    tableBody.innerHTML = '';
    data.forEach(estacion => {
        const row = document.createElement('tr');
        row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap"><div class="text-sm font-medium text-gray-900">${estacion.nombre}</div><div class="text-sm text-gray-500">${estacion.codigo}</div></td><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${estacion.calidad_precipitacion}%</td><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${estacion.calidad_temperatura}%</td><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${estacion.calidad_nivelAgua}%</td>`;
        tableBody.appendChild(row);
    });
}
let sortDirection = {};
function sortCalidadTable(sortKey) {
    const direction = (sortDirection[sortKey] || 'desc') === 'desc' ? 'asc' : 'desc';
    sortDirection = { [sortKey]: direction };
    datosDeCalidad.sort((a, b) => {
        if (direction === 'asc') return a[sortKey] - b[sortKey];
        else return b[sortKey] - a[sortKey];
    });
    renderCalidadTable(datosDeCalidad);
}

// --- SECCIÓN 3: RECONSTRUCCIÓN DE DATOS ---
function inicializarSeccionReconstruccion() {
    const variableSelect = document.getElementById('recon-variable-select');
    const stationSelect = document.getElementById('recon-station-select');
    const reconButton = document.getElementById('recon-button');
    if (reconButton.dataset.initialized) return;
    reconButton.dataset.initialized = 'true';
    variableSelect.addEventListener('change', () => {
        const variable = variableSelect.value;
        stationSelect.innerHTML = '<option value="" disabled selected>Elige una estación</option>';
        stationSelect.disabled = false;
        const estacionesFiltradas = todasLasEstaciones.filter(est => est[variable]);
        estacionesFiltradas.forEach(est => {
            const option = document.createElement('option');
            option.value = est.codigo;
            option.textContent = `${est.nombre} (${est.codigo})`;
            stationSelect.appendChild(option);
        });
    });
    reconButton.addEventListener('click', ejecutarReconstruccion);
}
async function ejecutarReconstruccion() {
    const variable = document.getElementById('recon-variable-select').value;
    const estacion = document.getElementById('recon-station-select').value;
    const metodo = document.getElementById('recon-method-select').value;
    const loadingIndicator = document.getElementById('recon-loading-indicator');
    const chartTitle = document.getElementById('recon-chart-title');
    const qualityInfoDiv = document.getElementById('recon-quality-info');
    const qualityBeforeSpan = document.getElementById('quality-before');
    const qualityAfterSpan = document.getElementById('quality-after');
    if (!variable || !estacion) {
        alert('Por favor, selecciona una variable y una estación.');
        return;
    }
    loadingIndicator.classList.remove('hidden');
    qualityInfoDiv.classList.add('hidden');
    chartTitle.innerText = `Reconstruyendo datos para ${estacion}...`;
    if (graficoReconstruccion) graficoReconstruccion.destroy();
    
    const selectedDates = reconDatepicker.selectedDates;
    let url = `${API_URL}/api/reconstruir-datos?variable=${variable}&estacion=${estacion}&metodo=${metodo}`;
    if (selectedDates.length === 2) {
        const fechaInicio = selectedDates[0].toISOString().split('T')[0];
        const fechaFin = selectedDates[1].toISOString().split('T')[0];
        url += `&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
    }

    try {
        const response = await fetch(url);
        const result = await response.json();
        if (!response.ok) {
            if (result.error === "Calidad de datos insuficiente") {
                alert(`La disponibilidad de datos originales (${result.quality_before}%) es demasiado baja para una reconstrucción fiable (se requiere > 65%).`);
                chartTitle.innerText = 'Reconstrucción no viable';
            } else {
                throw new Error(result.error || `Error del servidor: ${response.status}`);
            }
            return;
        }
        if (result && result.data && result.data.length > 0) {
            dibujarGraficoReconstruccion(result.data, estacion);
            chartTitle.innerText = `Comparación de Reconstrucción para ${estacion}`;
            qualityBeforeSpan.textContent = `${result.quality_before}%`;
            qualityAfterSpan.textContent = `${result.quality_after}%`;
            qualityInfoDiv.classList.remove('hidden');
        } else {
            chartTitle.innerText = 'No se encontraron datos para reconstruir.';
        }
    } catch (error) {
        console.error('Error al reconstruir los datos:', error);
        chartTitle.innerText = 'Error al reconstruir los datos.';
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}
function dibujarGraficoReconstruccion(datos, estacion) {
    const ctx = document.getElementById('reconstructionChart').getContext('2d');
    const labels = datos.map(d => d.fecha);
    const datasets = [{
        label: `Original (${estacion})`,
        data: datos.map(d => d.original),
        borderColor: 'rgba(255, 99, 132, 0.5)',
        borderWidth: 2,
        pointRadius: 2,
        pointBackgroundColor: 'rgba(255, 99, 132, 0.5)',
        fill: false
    }, {
        label: `Reconstruido`,
        data: datos.map(d => d.reconstruido),
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderWidth: 2,
        fill: true,
    }];
    if (graficoReconstruccion) {
        graficoReconstruccion.destroy();
    }
    graficoReconstruccion = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, title: { display: true, text: `Reconstrucción de datos para la estación ${estacion}` }}, scales: { y: { beginAtZero: true }}}});
}

// --- SECCIÓN 4: NARRATIVAS CLIMÁTICAS ---
function inicializarSeccionNarrativas() {
    const buttons = document.querySelectorAll('.narrativa-button');
    buttons.forEach(button => {
        if (button.dataset.initialized) return;
        button.dataset.initialized = 'true';
        button.addEventListener('click', () => {
            const tema = button.dataset.tema;
            generarNarrativa(tema);
        });
    });
}
async function generarNarrativa(tema) {
    const loadingDiv = document.getElementById('narrativa-loading');
    const resultadoDiv = document.getElementById('narrativa-resultado');
    loadingDiv.classList.remove('hidden');
    resultadoDiv.classList.add('hidden');
    try {
        const response = await fetch(`${API_URL}/api/generar-narrativa?tema=${tema}`);
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Error desconocido al generar la narrativa.');
        }
        resultadoDiv.innerHTML = marked.parse(result.narrativa);
    } catch (error) {
        console.error('Error al generar la narrativa:', error);
        resultadoDiv.innerHTML = `<p class="text-red-500">Hubo un error al contactar a la IA. Por favor, inténtalo de nuevo más tarde.</p>`;
    } finally {
        loadingDiv.classList.add('hidden');
        resultadoDiv.classList.remove('hidden');
    }
}

// --- NUEVO: SECCIÓN 5: ANÁLISIS COMPARATIVO ---
function inicializarSeccionComparativo() {
    const variableSelect = document.getElementById('comp-variable-select');
    const stationSelect = document.getElementById('comp-station-select');
    const yearListDiv = document.getElementById('comp-year-list');
    const compButton = document.getElementById('comp-button');

    if (compButton.dataset.initialized) return;
    compButton.dataset.initialized = 'true';

    variableSelect.addEventListener('change', async () => {
        const variable = variableSelect.value;
        stationSelect.innerHTML = '<option value="" disabled selected>Elige una estación</option>';
        stationSelect.disabled = false;
        yearListDiv.innerHTML = ''; // Limpiar años

        const estacionesFiltradas = todasLasEstaciones.filter(est => est[variable]);
        estacionesFiltradas.forEach(est => {
            const option = document.createElement('option');
            option.value = est.codigo;
            option.textContent = `${est.nombre} (${est.codigo})`;
            stationSelect.appendChild(option);
        });

        // Cargar los años disponibles para esta variable
        const response = await fetch(`${API_URL}/api/comparativo-anual?variable=${variable}`);
        const result = await response.json();
        if (result.anios_disponibles) {
            result.anios_disponibles.reverse().forEach(anio => {
                const div = document.createElement('div');
                div.className = 'flex items-center';
                div.innerHTML = `<input type="checkbox" id="year-${anio}" value="${anio}" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"><label for="year-${anio}" class="ml-2 text-sm">${anio}</label>`;
                yearListDiv.appendChild(div);
            });
        }
    });

    compButton.addEventListener('click', ejecutarComparativo);
}

async function ejecutarComparativo() {
    const variable = document.getElementById('comp-variable-select').value;
    const estacion = document.getElementById('comp-station-select').value;
    const mes = document.getElementById('comp-month-select').value;
    const aniosSeleccionados = Array.from(document.querySelectorAll('#comp-year-list input:checked')).map(el => el.value);
    const loadingIndicator = document.getElementById('comp-loading-indicator');
    const chartTitle = document.getElementById('comp-chart-title');

    if (!variable || !estacion || aniosSeleccionados.length < 2) {
        alert('Por favor, selecciona una variable, una estación y al menos dos años para comparar.');
        return;
    }

    loadingIndicator.classList.remove('hidden');
    chartTitle.innerText = `Generando comparación para ${estacion}...`;
    if (graficoComparativo) graficoComparativo.destroy();

    const url = `${API_URL}/api/comparativo-anual?variable=${variable}&estacion=${estacion}&mes=${mes}&anios=${aniosSeleccionados.join(',')}`;

    try {
        const response = await fetch(url);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error del servidor');

        if (result.data && result.data.length > 0) {
            dibujarGraficoComparativo(result.data, variable);
            const nombreMes = document.getElementById('comp-month-select').options[mes-1].text;
            chartTitle.innerText = `Comparación de ${VARIABLE_NOMBRES[variable]} en ${nombreMes} para ${estacion}`;
        } else {
            chartTitle.innerText = 'No hay datos suficientes para la comparación.';
        }
    } catch (error) {
        console.error('Error al generar la comparación:', error);
        chartTitle.innerText = 'Error al generar la comparación.';
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

function dibujarGraficoComparativo(datos, variable) {
    const ctx = document.getElementById('comparativoChart').getContext('2d');
    const labels = datos.map(d => d.anio);
    const valores = datos.map(d => d.valor);
    const nombreMetrica = variable === 'precipitacion' ? 'Precipitación Total (mm)' : `Promedio de ${VARIABLE_NOMBRES[variable]}`;

    if (graficoComparativo) {
        graficoComparativo.destroy();
    }

    graficoComparativo = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: nombreMetrica,
                data: valores,
                backgroundColor: 'rgba(79, 70, 229, 0.8)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: nombreMetrica }
                }
            }
        }
    });
}


// --- FUNCIONES DE UTILIDAD (DATE PICKER Y EXPORTACIÓN) ---

function inicializarDatepickers() {
    const options = {
        mode: "range",
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "F j, Y",
        onClose: function(selectedDates, dateStr, instance) {
            if (instance.element.id === 'explorador-datepicker') {
                actualizarGrafico();
            }
        }
    };
    exploradorDatepicker = flatpickr("#explorador-datepicker", options);
    reconDatepicker = flatpickr("#recon-datepicker", options);
}

function setupExportButtons() {
    document.getElementById('export-csv-button').addEventListener('click', exportToCSV);
    document.getElementById('export-png-button').addEventListener('click', exportToPNG);
}

function exportToCSV() {
    if (datosGraficoActual.length === 0) {
        alert("No hay datos para exportar.");
        return;
    }
    const headers = Object.keys(datosGraficoActual[0]);
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

    datosGraficoActual.forEach(row => {
        const values = headers.map(header => row[header]);
        csvContent += values.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "datos_climaticos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportToPNG() {
    if (!grafico) {
        alert("No hay gráfico para exportar.");
        return;
    }
    const link = document.createElement('a');
    link.href = grafico.toBase64Image();
    link.download = 'grafico_climatico.png';
    link.click();
}
