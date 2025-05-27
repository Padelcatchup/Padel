const PadelApp = (() => {
    // --- CONSTANTES DE CONFIGURACIÓN ---
    const EXCEL_FILE_PATH = './Padel2.xlsx'; // Asegúrate que este archivo esté en la misma carpeta que index.html
    const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search';
    const NOMINATIM_USER_AGENT = 'PadelMapApp/1.0 (tuemail@example.com)'; // ¡IMPORTANTE! Cambia esto por tu email o un identificador único
    const DEFAULT_MAP_VIEW = { center: [-34.6118, -58.396], zoom: 11 };
    const USER_LOCATION_ZOOM = 13;
    const SINGLE_MARKER_ZOOM = 15; // Zoom más cercano para un solo marcador

    // --- ESTADO DE LA APLICACIÓN ---
    let mapInstance = null;
    let markerClusterGroup = null;
    let userLocationMarker = null;
    let allCourtsData = [];
    let filteredCourtsData = [];
    let currentUserLocation = null; // [lat, lng]
    let uniqueLocalidadesSet = new Set();
    let uniqueZonasSet = new Set();

    // --- CACHÉ DE ELEMENTOS DEL DOM ---
    const DOMElements = {
        loadingOverlay: null,
        loadingMessage: null,
        messageArea: null,
        btnGetUserLocation: null,
        visibleCourtsCount: null,
        nearestCourtDistance: null,
        inputLocalidad: null,
        localidadesDataList: null,
        selectZona: null,
        btnClearFilters: null,
        mapContainer: null,
    };

    // --- FUNCIONES UTILITARIAS ---
    const Utils = {
        ensureHttp: (url) => {
            if (!url) return '';
            if (/^https?:\/\//i.test(url)) return url;
            if (/^@?([a-z0-9_.-]+)$/i.test(url)) return `https://instagram.com/${url.replace('@', '')}`;
            return `https://${url}`;
        },
        pickExcelColumn: (row, potentialKeys) => {
            const foundKey = potentialKeys.find(key => row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '');
            return foundKey ? String(row[key]).trim() : undefined;
        },
        // debounce: (func, delay) => { // Útil si el filtrado en input es muy pesado
        //     let timeout;
        //     return function(...args) {
        //         clearTimeout(timeout);
        //         timeout = setTimeout(() => func.apply(this, args), delay);
        //     };
        // }
    };

    // --- MANEJO DE UI (Feedback: Loading y Mensajes) ---
    const UI = {
        showLoading: (message = "Cargando...") => {
            if (DOMElements.loadingOverlay && DOMElements.loadingMessage) {
                DOMElements.loadingMessage.textContent = message;
                DOMElements.loadingOverlay.classList.remove('hidden');
            }
        },
        hideLoading: () => {
            if (DOMElements.loadingOverlay) {
                DOMElements.loadingOverlay.classList.add('hidden');
            }
        },
        displayMessage: (text, type = 'info', duration = 0) => { // type: info, success, error, warning
            if (DOMElements.messageArea) {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message message-${type}`;
                messageDiv.textContent = text;
                DOMElements.messageArea.innerHTML = ''; // Limpiar mensajes anteriores
                DOMElements.messageArea.appendChild(messageDiv);

                if (duration > 0) {
                    setTimeout(() => {
                        if (messageDiv.parentNode === DOMElements.messageArea) { // Solo si aún es el mensaje actual
                           DOMElements.messageArea.innerHTML = '';
                        }
                    }, duration);
                }
            }
        },
        clearMessages: () => {
            if (DOMElements.messageArea) DOMElements.messageArea.innerHTML = '';
        },
        updateCounters: () => {
            if (DOMElements.visibleCourtsCount) DOMElements.visibleCourtsCount.textContent = filteredCourtsData.length;
            if (DOMElements.nearestCourtDistance) {
                if (currentUserLocation && filteredCourtsData.length > 0) {
                    let minDistance = Infinity;
                    filteredCourtsData.forEach(court => {
                        if (court.lat && court.lng) {
                            const distance = mapInstance.distance(currentUserLocation, [court.lat, court.lng]);
                            if (distance < minDistance) minDistance = distance;
                        }
                    });
                    DOMElements.nearestCourtDistance.textContent = isFinite(minDistance) ? `${(minDistance / 1000).toFixed(2)} km` : '--';
                } else {
                    DOMElements.nearestCourtDistance.textContent = '--';
                }
            }
        }
    };

    // --- MANEJO DEL MAPA ---
    const MapManager = {
        init: () => {
            mapInstance = L.map(DOMElements.mapContainer); // Usar el ID del div contenedor
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(mapInstance);

            markerClusterGroup = L.markerClusterGroup();
            mapInstance.addLayer(markerClusterGroup);

            // Cargar vista guardada o usar default
            const savedView = LocalStorageManager.getMapView();
            mapInstance.setView(savedView.center, savedView.zoom);
            
            mapInstance.on('moveend zoomend', () => { // Guardar vista al cambiar
                LocalStorageManager.saveMapView({ center: mapInstance.getCenter(), zoom: mapInstance.getZoom() });
            });
        },
        renderMarkers: () => {
            markerClusterGroup.clearLayers();
            const canchaIcon = L.AwesomeMarkers.icon({ icon: 'table-tennis-paddle-ball', prefix: 'fas', markerColor: 'green', iconColor: 'white' });

            filteredCourtsData.forEach(court => {
                if (typeof court.lat !== 'number' || typeof court.lng !== 'number' || isNaN(court.lat) || isNaN(court.lng)) {
                    console.warn('Marcador omitido por lat/lng inválido:', court);
                    return;
                }
                const marker = L.marker([court.lat, court.lng], { icon: canchaIcon });
                marker.bindPopup(MapManager.buildPopupContent(court));
                markerClusterGroup.addLayer(marker);
            });
        },
        buildPopupContent: (court) => {
            const tel = court.telefono ? `<p><i class='fas fa-phone text-blue-500 mr-2'></i><a href='tel:${court.telefono.replace(/[^0-9+]/g, '')}' class='text-blue-600 hover:underline'>${court.telefono}</a></p>` : '';
            const ig = court.instagram ? `<p><i class='fab fa-instagram text-pink-500 mr-2'></i><a href='${Utils.ensureHttp(court.instagram)}' target='_blank' rel='noopener' class='text-pink-600 hover:underline'>Ver Instagram</a></p>` : '';
            const rs = court.reserva ? `<p><i class='fas fa-calendar-check text-green-500 mr-2'></i><a href='${Utils.ensureHttp(court.reserva)}' target='_blank' rel='noopener' class='text-green-600 hover:underline'>Reservar Online</a></p>` : '';
            
            let distanceInfo = '';
            if (currentUserLocation && court.lat && court.lng) {
                const distance = mapInstance.distance(currentUserLocation, [court.lat, court.lng]);
                distanceInfo = `<p class="mt-2 pt-2 border-t border-gray-200"><i class='fas fa-route text-purple-500 mr-2'></i>Distancia: <strong>${(distance / 1000).toFixed(2)} km</strong></p>`;
            }

            return `<h3 class='font-semibold text-lg mb-1 text-gray-800'>${court.nombre}</h3>
                    <p class='mb-1 text-gray-700'><i class='fas fa-map-marker-alt text-red-500 mr-2'></i>${court.direccion}</p>
                    <p class='mb-2 text-sm text-gray-600'>${court.localidad} ${court.zona && court.zona !== 'Sin zona' ? `(${court.zona})` : ''}</p>
                    ${tel}${ig}${rs}${distanceInfo}`;
        },
        adjustViewToFilteredMarkers: () => {
            if (!mapInstance || filteredCourtsData.length === 0) {
                if (filteredCourtsData.length === 0 && (DOMElements.inputLocalidad.value || DOMElements.selectZona.value)) {
                    // No hacer nada si hay filtros activos pero sin resultados, mantener vista actual.
                } else {
                   // mapInstance.setView(DEFAULT_MAP_VIEW.center, DEFAULT_MAP_VIEW.zoom); // Opcional: volver a default si no hay filtros
                }
                return;
            }

            if (filteredCourtsData.length === 1) {
                mapInstance.setView([filteredCourtsData[0].lat, filteredCourtsData[0].lng], SINGLE_MARKER_ZOOM);
            } else {
                const bounds = L.latLngBounds(filteredCourtsData.map(c => [c.lat, c.lng]));
                if (bounds.isValid()) {
                    mapInstance.fitBounds(bounds, { padding: [50, 50] });
                }
            }
        },
        updateUserMarker: (lat, lng) => {
            const userIcon = L.AwesomeMarkers.icon({ icon: 'street-view', prefix: 'fas', markerColor: 'blue', iconColor: 'white' });
            if (userLocationMarker) {
                mapInstance.removeLayer(userLocationMarker);
            }
            userLocationMarker = L.marker([lat, lng], { icon: userIcon })
                .addTo(mapInstance)
                .bindPopup("<b>¡Estás aquí!</b>")
                .openPopup();
            mapInstance.setView([lat, lng], USER_LOCATION_ZOOM);
        }
    };

    // --- MANEJO DE DATOS (Excel, Filtros) ---
    const DataManager = {
        loadAndProcessExcel: async () => {
            UI.showLoading("Cargando datos de canchas...");
            allCourtsData = []; // Reset
            uniqueLocalidadesSet.clear();
            uniqueZonasSet.clear();

            try {
                const response = await fetch(EXCEL_FILE_PATH);
                if (!response.ok) throw new Error(`No se pudo cargar el archivo Excel (${response.status})`);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                if (!rows.length) {
                    UI.displayMessage('El archivo Excel está vacío o no tiene el formato esperado.', 'warning');
                    return;
                }

                let courtsToGeocodeCount = 0;
                const geocodingPromises = [];

                for (const [index, row] of rows.entries()) {
                    UI.showLoading(`Procesando cancha ${index + 1} de ${rows.length}...`);
                    
                    let lat = parseFloat(String(Utils.pickExcelColumn(row, ['Latitud', 'lat', 'LATITUD']) || '').replace(',', '.'));
                    let lng = parseFloat(String(Utils.pickExcelColumn(row, ['Longitud', 'lng', 'LONGITUD']) || '').replace(',', '.'));
                    
                    const nombre = Utils.pickExcelColumn(row, ['Nombre de la Cancha', 'Nombre']) || 'Nombre no disponible';
                    const direccion = Utils.pickExcelColumn(row, ['Dirección', 'Direccion']) || 'Dirección no disponible';
                    const localidadRaw = Utils.pickExcelColumn(row, ['Localidad']) || 'Sin localidad';
                    
                    const zonaMatch = localidadRaw.match(/\(([^)]+)\)$/); // Extraer zona entre paréntesis al final
                    const zona = zonaMatch ? zonaMatch[1].trim() : 'Sin zona';
                    const localidad = zonaMatch ? localidadRaw.replace(/\s*\(([^)]+)\)$/, '').trim() : localidadRaw.trim();

                    const court = {
                        nombre,
                        direccion,
                        localidad,
                        zona,
                        telefono: Utils.pickExcelColumn(row, ['Teléfono', 'Telefono']) || '',
                        instagram: Utils.pickExcelColumn(row, ['Instagram']) || '',
                        reserva: Utils.pickExcelColumn(row, ['Link de Reserva', 'Reserva']) || '',
                        lat: NaN, lng: NaN // Iniciar como NaN
                    };

                    if (!isNaN(lat) && !isNaN(lng)) {
                        court.lat = lat;
                        court.lng = lng;
                        allCourtsData.push(court);
                        uniqueLocalidadesSet.add(court.localidad);
                        uniqueZonasSet.add(court.zona);
                    } else if (direccion !== 'Dirección no disponible' && localidad !== 'Sin localidad') {
                        courtsToGeocodeCount++;
                        // En lugar de await aquí, recolectamos promesas para geocodificación en paralelo (controlado)
                        geocodingPromises.push(
                            DataManager.geocodeAddress(`${direccion}, ${localidad}, Buenos Aires, Argentina`)
                                .then(geoCoords => {
                                    if (geoCoords) {
                                        court.lat = geoCoords.lat;
                                        court.lng = geoCoords.lng;
                                        allCourtsData.push(court);
                                        uniqueLocalidadesSet.add(court.localidad);
                                        uniqueZonasSet.add(court.zona);
                                    } else {
                                        console.warn(`No se pudo geocodificar: ${nombre} en ${direccion}`);
                                    }
                                })
                        );
                         // Si hay muchas geocodificaciones, podríamos necesitar un sistema de cola con delays
                         // para no saturar Nominatim. Para este ejemplo, Promise.all es un inicio.
                        if (geocodingPromises.length % 5 === 0 && geocodingPromises.length > 0) { // Procesar en lotes pequeños
                            UI.showLoading(`Geocodificando ${courtsToGeocodeCount} direcciones (lote ${geocodingPromises.length/5})...`);
                            await Promise.all(geocodingPromises.splice(0, 5)); // Procesar y vaciar lote
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Pausa entre lotes
                        }
                    } else {
                         console.warn(`Cancha '${nombre}' omitida por falta de lat/lng y dirección/localidad completa.`);
                    }
                }
                
                // Procesar cualquier promesa de geocodificación restante
                if (geocodingPromises.length > 0) {
                    UI.showLoading(`Finalizando geocodificación de ${geocodingPromises.length} direcciones restantes...`);
                    await Promise.all(geocodingPromises);
                }

                DataManager.populateFilterControls();
                UI.displayMessage(`Se cargaron ${allCourtsData.length} canchas.`, 'success', 3000);

            } catch (error) {
                console.error("Error cargando o procesando Excel:", error);
                UI.displayMessage(`Error al cargar datos: ${error.message}`, 'error');
                allCourtsData = []; // Asegurar estado limpio
            } finally {
                UI.hideLoading();
            }
        },
        geocodeAddress: async (address) => {
            try {
                const url = `${NOMINATIM_API_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
                const response = await fetch(url, { headers: { 'User-Agent': 'Ubica tu Cancha de Padel' } });
                if (!response.ok) {
                    console.error(`Error de Nominatim (${response.status}): ${await response.text()}`);
                    return null;
                }
                const data = await response.json();
                if (data && data.length > 0) {
                    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                }
                return null;
            } catch (error) {
                console.error(`Excepción durante geocodificación de "${address}":`, error);
                return null;
            }
        },
        populateFilterControls: () => {
            // Poblar Zonas
            DOMElements.selectZona.innerHTML = '<option value="">Filtro rápido por zona</option>';
            const sortedZonas = [...uniqueZonasSet].filter(z => z !== 'Sin zona').sort();
            if (uniqueZonasSet.has('Sin zona')) sortedZonas.push('Sin zona'); // Poner "Sin zona" al final
            
            sortedZonas.forEach(zona => {
                const option = new Option(zona, zona);
                DOMElements.selectZona.add(option);
            });
            // Poblar Localidades (datalist) inicialmente
            DataManager.updateLocalidadesDataList();
        },
        updateLocalidadesDataList: (selectedZona = '') => {
            DOMElements.localidadesDataList.innerHTML = '';
            let localidadesToShow;
            if (selectedZona) {
                localidadesToShow = new Set(allCourtsData.filter(c => c.zona === selectedZona).map(c => c.localidad));
            } else {
                localidadesToShow = uniqueLocalidadesSet;
            }
            [...localidadesToShow].sort().forEach(loc => {
                const option = document.createElement('option');
                option.value = loc;
                DOMElements.localidadesDataList.appendChild(option);
            });
        },
        applyFilters: () => {
            UI.clearMessages();
            const searchTerm = DOMElements.inputLocalidad.value.toLowerCase().trim();
            const selectedZona = DOMElements.selectZona.value;

            filteredCourtsData = allCourtsData.filter(court => {
                const matchLocalidad = !searchTerm || court.localidad.toLowerCase().includes(searchTerm);
                const matchZona = !selectedZona || court.zona === selectedZona;
                return matchLocalidad && matchZona;
            });

            MapManager.renderMarkers();
            UI.updateCounters();
            MapManager.adjustViewToFilteredMarkers();
            LocalStorageManager.saveFilters({ localidad: searchTerm, zona: selectedZona });

            if (filteredCourtsData.length === 0 && (searchTerm || selectedZona)) {
                UI.displayMessage('No se encontraron canchas con los filtros aplicados.', 'info');
            }
        }
    };

    // --- GEOLOCALIZACIÓN DEL USUARIO ---
    const UserLocation = {
        get: () => {
            if (!navigator.geolocation) {
                UI.displayMessage("La geolocalización no está soportada por tu navegador.", 'error');
                return;
            }
            UI.showLoading("Obteniendo tu ubicación...");
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    UI.hideLoading();
                    currentUserLocation = [position.coords.latitude, position.coords.longitude];
                    MapManager.updateUserMarker(currentUserLocation[0], currentUserLocation[1]);
                    UI.updateCounters(); // Actualizar "más cercana"
                    UI.displayMessage("Ubicación obtenida.", 'success', 3000);
                },
                (error) => {
                    UI.hideLoading();
                    currentUserLocation = null; // Resetear si falla
                     if (userLocationMarker) { mapInstance.removeLayer(userLocationMarker); userLocationMarker = null; }
                    UI.updateCounters();
                    let msg = "Error al obtener la ubicación: ";
                    switch (error.code) {
                        case error.PERMISSION_DENIED: msg += "Permiso denegado."; break;
                        case error.POSITION_UNAVAILABLE: msg += "Información de ubicación no disponible."; break;
                        case error.TIMEOUT: msg += "Tiempo de espera agotado."; break;
                        default: msg += "Error desconocido."; break;
                    }
                    UI.displayMessage(msg, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }
    };
    
    // --- MANEJO DE LOCALSTORAGE ---
    const LocalStorageManager = {
        saveFilters: (filters) => {
            try {
                localStorage.setItem('padelMap_filters', JSON.stringify(filters));
            } catch (e) { console.error("Error guardando filtros en localStorage:", e); }
        },
        loadFilters: () => {
            try {
                const saved = localStorage.getItem('padelMap_filters');
                return saved ? JSON.parse(saved) : { localidad: '', zona: '' };
            } catch (e) {
                console.error("Error cargando filtros de localStorage:", e);
                return { localidad: '', zona: '' };
            }
        },
        saveMapView: (view) => { // view = { center: {lat, lng}, zoom: number }
             try {
                localStorage.setItem('padelMap_mapView', JSON.stringify(view));
            } catch (e) { console.error("Error guardando vista del mapa en localStorage:", e); }
        },
        getMapView: () => {
            try {
                const saved = localStorage.getItem('padelMap_mapView');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Validar que los datos sean correctos
                    if (parsed && typeof parsed.zoom === 'number' && 
                        parsed.center && typeof parsed.center.lat === 'number' && typeof parsed.center.lng === 'number') {
                        return parsed;
                    }
                }
            } catch (e) { console.error("Error cargando vista del mapa de localStorage:", e); }
            return DEFAULT_MAP_VIEW; // Default si no hay nada o está corrupto
        }
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        DOMElements.btnGetUserLocation.addEventListener('click', UserLocation.get);
        
        DOMElements.inputLocalidad.addEventListener('input', DataManager.applyFilters);
        // DOMElements.inputLocalidad.addEventListener('input', Utils.debounce(DataManager.applyFilters, 300)); // Si se quiere debounce

        DOMElements.selectZona.addEventListener('change', () => {
            DataManager.updateLocalidadesDataList(DOMElements.selectZona.value);
            DataManager.applyFilters();
        });
        
        DOMElements.btnClearFilters.addEventListener('click', () => {
            DOMElements.inputLocalidad.value = '';
            DOMElements.selectZona.value = '';
            DataManager.updateLocalidadesDataList(); // Resetear datalist
            DataManager.applyFilters();
            mapInstance.setView(DEFAULT_MAP_VIEW.center, DEFAULT_MAP_VIEW.zoom); // Volver a vista default
            UI.clearMessages();
        });
    };

    // --- INICIALIZACIÓN DE LA APLICACIÓN ---
    const init = async () => {
        // Cachear elementos del DOM
        for (const key in DOMElements) {
            DOMElements[key] = document.getElementById(key);
            if (!DOMElements[key] && key !== 'localidadesDataList') { // datalist es hijo de inputLocalidad y no es crítico si falta
                console.error(`Elemento del DOM no encontrado: #${key}. La aplicación podría no funcionar correctamente.`);
                if (key === 'mapContainer' || key === 'loadingOverlay') { // Críticos
                    document.body.innerHTML = `<p style="color:red; padding:20px;">Error crítico: Falta el elemento #${key}. No se puede iniciar la aplicación.</p>`;
                    return; // Detener ejecución
                }
            }
        }
        // Asegurar que localidadesDataList sea el elemento correcto (es un ID diferente al input)
        DOMElements.localidadesDataList = document.getElementById('localidadesDataList');


        MapManager.init(); // Iniciar mapa primero para que la vista de localStorage se aplique

        const savedFilters = LocalStorageManager.loadFilters();
        DOMElements.inputLocalidad.value = savedFilters.localidad;
        // DOMElements.selectZona.value = savedFilters.zona; // Esto se setea después de poblarlo

        await DataManager.loadAndProcessExcel(); // Cargar y procesar datos

        // Una vez que las zonas están pobladas, podemos intentar establecer la zona guardada
        if (savedFilters.zona && DOMElements.selectZona.querySelector(`option[value="${savedFilters.zona}"]`)) {
            DOMElements.selectZona.value = savedFilters.zona;
            DataManager.updateLocalidadesDataList(savedFilters.zona); // Actualizar datalist si se cargó una zona
        }
        
        DataManager.applyFilters(); // Aplicar filtros (cargados o por defecto)
        setupEventListeners();
        UI.hideLoading(); // Asegurar que se oculte si todo va bien
    };

    // Exponer la función de inicialización
    return {
        start: init
    };
})();

// Iniciar la aplicación cuando el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', PadelApp.start);