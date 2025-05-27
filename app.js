const PadelApp = (() => {
    // --- CONSTANTES DE CONFIGURACIÓN ---
    const EXCEL_FILE_PATH = './Padel2.xlsx';
    const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search';
    // #############################################################################################
    // ## ¡MUY IMPORTANTE! CAMBIA LA SIGUIENTE LÍNEA POR UN USER-AGENT ÚNICO Y DESCRIPTIVO!      ##
    // ## EJEMPLO: 'NombreDeTuAppPadel/1.0 (tuemail@example.com o https://tu-proyecto.com)'     ##
    // ## NO USAR EL VALOR POR DEFECTO EN PRODUCCIÓN O PARA MUCHOS REQUESTS.                     ##
    // #############################################################################################
    const NOMINATIM_USER_AGENT = 'PadelCourtFinderApp/1.0 (PORFAVOR_CAMBIA_ESTO@example.com)'; // <-- ¡¡¡CAMBIA ESTO!!!
    const DEFAULT_MAP_VIEW = { center: [-34.6118, -58.396], zoom: 11 };
    const USER_LOCATION_ZOOM = 13;
    const SINGLE_MARKER_ZOOM = 15;

    // --- ESTADO DE LA APLICACIÓN ---
    let mapInstance = null;
    let markerClusterGroup = null;
    let userLocationMarker = null;
    let allCourtsData = [];
    let filteredCourtsData = [];
    let currentUserLocation = null;
    let uniqueLocalidadesSet = new Set();
    let uniqueZonasSet = new Set();
    let initialDataLoadedSuccessfully = false; // Flag para saber si los datos cargaron

    // --- CACHÉ DE ELEMENTOS DEL DOM ---
    const DOMElements = {
        loadingOverlay: null, loadingMessage: null, messageArea: null,
        btnGetUserLocation: null, visibleCourtsCount: null, nearestCourtDistance: null,
        inputLocalidad: null, localidadesDataList: null, selectZona: null,
        btnClearFilters: null, mapContainer: null,
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
            const foundKey = potentialKeys.find(k => row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '');
            return foundKey ? String(row[foundKey]).trim() : undefined;
        },
    };

    // --- MANEJO DE UI ---
    const UI = {
        showLoading: (message = "Cargando...") => {
            if (DOMElements.loadingOverlay && DOMElements.loadingMessage) {
                DOMElements.loadingMessage.textContent = message;
                DOMElements.loadingOverlay.classList.remove('hidden');
            }
        },
        hideLoading: () => {
            if (DOMElements.loadingOverlay) DOMElements.loadingOverlay.classList.add('hidden');
        },
        displayMessage: (text, type = 'info', duration = 0) => {
            if (DOMElements.messageArea) {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message message-${type}`;
                messageDiv.textContent = text;
                if (type !== 'error' && type !== 'warning') { // No limpiar errores/warnings tan rápido
                    DOMElements.messageArea.innerHTML = ''; // Limpiar mensajes previos si no son errores
                } else if (DOMElements.messageArea.firstChild && !DOMElements.messageArea.firstChild.className.includes(type)) {
                    DOMElements.messageArea.innerHTML = ''; // Limpiar si el mensaje anterior no era del mismo tipo de severidad
                }
                DOMElements.messageArea.appendChild(messageDiv);
                if (duration > 0) {
                    setTimeout(() => {
                        if (messageDiv.parentNode === DOMElements.messageArea && messageDiv.textContent === text) {
                           DOMElements.messageArea.removeChild(messageDiv);
                        }
                    }, duration);
                }
            }
        },
        clearMessages: (typeToClear = null) => { 
            if (DOMElements.messageArea) {
                if (typeToClear) {
                    const messagesOfType = DOMElements.messageArea.querySelectorAll(`.message-${typeToClear}`);
                    messagesOfType.forEach(msg => DOMElements.messageArea.removeChild(msg));
                } else {
                    DOMElements.messageArea.innerHTML = '';
                }
            }
        },
        updateCounters: () => {
            if (DOMElements.visibleCourtsCount) DOMElements.visibleCourtsCount.textContent = filteredCourtsData.length;
            if (DOMElements.nearestCourtDistance) {
                if (currentUserLocation && filteredCourtsData.length > 0 && mapInstance) {
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
            if (!DOMElements.mapContainer) {
                console.error("Error: mapContainer no encontrado en el DOM.");
                UI.displayMessage("Error crítico: No se puede inicializar el mapa.", "error");
                return false;
            }
            try {
                mapInstance = L.map(DOMElements.mapContainer);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }).addTo(mapInstance);

                if (typeof L.markerClusterGroup !== 'function') {
                    console.error("Error crítico: L.markerClusterGroup no está disponible. ¿Se cargó el script correctamente?");
                    UI.displayMessage("Error al inicializar el mapa: Fallo en la librería de clustering.", "error");
                    return false;
                }
                markerClusterGroup = L.markerClusterGroup();
                mapInstance.addLayer(markerClusterGroup);

                const savedView = LocalStorageManager.getMapView();
                mapInstance.setView(savedView.center, savedView.zoom);
                
                mapInstance.on('moveend zoomend', () => {
                    LocalStorageManager.saveMapView({ center: mapInstance.getCenter(), zoom: mapInstance.getZoom() });
                });
            } catch (e) {
                console.error("Excepción durante la inicialización del mapa:", e);
                UI.displayMessage("Error inesperado al inicializar el mapa.", "error");
                return false;
            }
            return true;
        },
        renderMarkers: () => {
            if (!markerClusterGroup) {
                console.error("Error crítico: markerClusterGroup no está inicializado.");
                UI.displayMessage("Error al mostrar marcadores: Fallo en la inicialización del mapa (cluster).", "error");
                return;
            }
            if (!L.AwesomeMarkers || typeof L.AwesomeMarkers.icon !== 'function') {
                console.error("Error crítico: L.AwesomeMarkers no está disponible. ¿Se cargó el script?");
                UI.displayMessage("Error al mostrar marcadores: Fallo en la librería de iconos.", "error");
                return;
            }

            markerClusterGroup.clearLayers();
            try {
                const canchaIcon = L.AwesomeMarkers.icon({ icon: 'table-tennis-paddle-ball', prefix: 'fas', markerColor: 'green', iconColor: 'white' });
                filteredCourtsData.forEach(court => {
                    if (typeof court.lat !== 'number' || typeof court.lng !== 'number' || isNaN(court.lat) || isNaN(court.lng)) {
                        return;
                    }
                    const marker = L.marker([court.lat, court.lng], { icon: canchaIcon });
                    marker.bindPopup(MapManager.buildPopupContent(court));
                    markerClusterGroup.addLayer(marker);
                });
            } catch (error) {
                console.error("Error durante la creación de AwesomeMarkers.icon o L.marker:", error);
                UI.displayMessage("Ocurrió un error al mostrar los iconos de las canchas.", "error");
            }
        },
        buildPopupContent: (court) => {
            const tel = court.telefono ? `<p><i class='fas fa-phone text-blue-500 mr-2'></i><a href='tel:${court.telefono.replace(/[^0-9+]/g, '')}' class='text-blue-600 hover:underline'>${court.telefono}</a></p>` : '';
            const ig = court.instagram ? `<p><i class='fab fa-instagram text-pink-500 mr-2'></i><a href='${Utils.ensureHttp(court.instagram)}' target='_blank' rel='noopener' class='text-pink-600 hover:underline'>Ver Instagram</a></p>` : '';
            const rs = court.reserva ? `<p><i class='fas fa-calendar-check text-green-500 mr-2'></i><a href='${Utils.ensureHttp(court.reserva)}' target='_blank' rel='noopener' class='text-green-600 hover:underline'>Reservar Online</a></p>` : '';
            let distanceInfo = '';
            if (currentUserLocation && court.lat && court.lng && mapInstance) {
                const distance = mapInstance.distance(currentUserLocation, [court.lat, court.lng]);
                distanceInfo = `<p class="mt-2 pt-2 border-t border-gray-200"><i class='fas fa-route text-purple-500 mr-2'></i>Distancia: <strong>${(distance / 1000).toFixed(2)} km</strong></p>`;
            }
            return `<h3 class='font-semibold text-lg mb-1 text-gray-800'>${court.nombre || 'Sin nombre'}</h3>
                    <p class='mb-1 text-gray-700'><i class='fas fa-map-marker-alt text-red-500 mr-2'></i>${court.direccion || 'Sin dirección'}</p>
                    <p class='mb-2 text-sm text-gray-600'>${court.localidad || 'Sin localidad'} ${court.zona && court.zona !== 'Sin zona' ? `(${court.zona})` : ''}</p>
                    ${tel}${ig}${rs}${distanceInfo}`;
        },
        adjustViewToFilteredMarkers: () => {
            if (!mapInstance || !initialDataLoadedSuccessfully) return;
            if (filteredCourtsData.length === 0) return;
            
            const validCoords = filteredCourtsData.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number' && !isNaN(c.lat) && !isNaN(c.lng));
            if (validCoords.length === 0) return;

            if (validCoords.length === 1) {
                mapInstance.setView([validCoords[0].lat, validCoords[0].lng], SINGLE_MARKER_ZOOM);
            } else {
                const bounds = L.latLngBounds(validCoords.map(c => [c.lat, c.lng]));
                if (bounds.isValid()) {
                    mapInstance.fitBounds(bounds, { padding: [50, 50] });
                }
            }
        },
        updateUserMarker: (lat, lng) => {
            if (!mapInstance || !L.AwesomeMarkers) return;
            const userIcon = L.AwesomeMarkers.icon({ icon: 'street-view', prefix: 'fas', markerColor: 'blue', iconColor: 'white' });
            if (userLocationMarker) mapInstance.removeLayer(userLocationMarker);
            userLocationMarker = L.marker([lat, lng], { icon: userIcon })
                .addTo(mapInstance)
                .bindPopup("<b>¡Estás aquí!</b>")
                .openPopup();
            mapInstance.setView([lat, lng], USER_LOCATION_ZOOM);
        }
    };

    // --- MANEJO DE DATOS ---
    const DataManager = {
        loadAndProcessExcel: async () => {
            UI.showLoading("Cargando datos de canchas...");
            allCourtsData = []; uniqueLocalidadesSet.clear(); uniqueZonasSet.clear();
            initialDataLoadedSuccessfully = false; // Reset flag
            try {
                const response = await fetch(EXCEL_FILE_PATH);
                if (!response.ok) throw new Error(`No se pudo cargar el archivo Excel: ${response.status} ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error("El archivo Excel no contiene hojas.");
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                if (!rows.length) {
                    UI.displayMessage('El archivo Excel está vacío o no tiene el formato esperado.', 'warning');
                    UI.hideLoading(); // Ocultar loading si el excel está vacío
                    return; // No continuar si está vacío
                }

                const geocodingQueue = []; // Direcciones a geocodificar

                for (const row of rows) {
                    let latStr = Utils.pickExcelColumn(row, ['Latitud', 'lat', 'LATITUD']);
                    let lngStr = Utils.pickExcelColumn(row, ['Longitud', 'lng', 'LONGITUD']);
                    let lat = latStr ? parseFloat(String(latStr).replace(',', '.')) : NaN;
                    let lng = lngStr ? parseFloat(String(lngStr).replace(',', '.')) : NaN;
                    
                    const nombre = Utils.pickExcelColumn(row, ['Nombre de la Cancha', 'Nombre']) || 'Nombre no disponible';
                    const direccion = Utils.pickExcelColumn(row, ['Dirección', 'Direccion']) || 'Dirección no disponible';
                    const localidadRaw = Utils.pickExcelColumn(row, ['Localidad']) || 'Sin localidad';
                    
                    const zonaMatch = localidadRaw.match(/\(([^)]+)\)$/);
                    const zona = zonaMatch ? zonaMatch[1].trim() : 'Sin zona';
                    const localidad = zonaMatch ? localidadRaw.replace(/\s*\(([^)]+)\)$/, '').trim() : localidadRaw.trim();

                    const court = {
                        nombre, direccion, localidad, zona,
                        telefono: Utils.pickExcelColumn(row, ['Teléfono', 'Telefono']) || '',
                        instagram: Utils.pickExcelColumn(row, ['Instagram']) || '',
                        reserva: Utils.pickExcelColumn(row, ['Link de Reserva', 'Reserva']) || '',
                        lat, lng // Puede ser NaN aquí
                    };

                    if (!isNaN(lat) && !isNaN(lng)) {
                        allCourtsData.push(court);
                        if(localidad.trim() && localidad !== 'Sin localidad') uniqueLocalidadesSet.add(localidad);
                        if(zona.trim() && zona !== 'Sin zona') uniqueZonasSet.add(zona);
                    } else if (direccion !== 'Dirección no disponible' && localidad.trim() && localidad !== 'Sin localidad') {
                        geocodingQueue.push({ court, addressString: `${direccion}, ${localidad}, Buenos Aires, Argentina` });
                    } else {
                         console.warn(`Cancha '${nombre}' omitida (pre-geocodificación) por falta de lat/lng y/o dirección/localidad completa.`);
                    }
                }
                
                // Procesar cola de geocodificación
                if (geocodingQueue.length > 0) {
                    UI.showLoading(`Geocodificando ${geocodingQueue.length} direcciones...`);
                    for (let i = 0; i < geocodingQueue.length; i++) {
                        const item = geocodingQueue[i];
                        UI.showLoading(`Geocodificando ${i + 1}/${geocodingQueue.length}: ${item.court.nombre}...`);
                        const geoCoords = await DataManager.geocodeAddress(item.addressString);
                        if (geoCoords) {
                            item.court.lat = geoCoords.lat;
                            item.court.lng = geoCoords.lng;
                            allCourtsData.push(item.court);
                            if(item.court.localidad.trim() && item.court.localidad !== 'Sin localidad') uniqueLocalidadesSet.add(item.court.localidad);
                            if(item.court.zona.trim() && item.court.zona !== 'Sin zona') uniqueZonasSet.add(item.court.zona);
                        } else {
                            console.warn(`No se pudo geocodificar: ${item.court.nombre} en ${item.addressString}`);
                        }
                        if (i < geocodingQueue.length - 1) { // No pausar después del último
                            await new Promise(resolve => setTimeout(resolve, 1100)); // Pausa > 1s por política de Nominatim
                        }
                    }
                }
                initialDataLoadedSuccessfully = true;
                DataManager.populateFilterControls();
                UI.displayMessage(`Se procesaron ${rows.length} registros. ${allCourtsData.length} canchas cargadas.`, 'success', 4000);

            } catch (error) {
                console.error("Error cargando o procesando Excel:", error);
                UI.displayMessage(`Error al cargar datos: ${error.message}. Revisa la consola.`, 'error');
                allCourtsData = []; // Asegurar estado limpio
                initialDataLoadedSuccessfully = false;
            } finally {
                UI.hideLoading();
            }
        },
        geocodeAddress: async (address) => {
            if (!address || String(address).trim() === '') {
                console.warn("Intento de geocodificar una dirección vacía.");
                return null;
            }
            try {
                const url = `${NOMINATIM_API_URL}?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(address)}`;
                const response = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
                
                if (!response.ok) {
                    const errorText = await response.text(); // Leer el cuerpo del error una sola vez
                    console.error(`Error de Nominatim (${response.status} ${response.statusText}) para: "${address}". Respuesta: ${errorText}`);
                    if (response.status === 403) { 
                        UI.displayMessage(`Servicio de geocodificación bloqueó la petición (Error 403). Verifica tu User-Agent.`, "error");
                    } else if (response.status === 429) { 
                         UI.displayMessage(`Demasiadas peticiones al servicio de geocodificación (Error 429).`, "warning");
                    }
                    return null;
                }
                const data = await response.json();
                if (data && data.length > 0 && data[0].lat && data[0].lon) {
                    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                }
                console.warn(`Nominatim no devolvió coordenadas válidas para: "${address}"`, data);
                return null;
            } catch (error) {
                console.error(`Excepción durante geocodificación de "${address}":`, error);
                return null;
            }
        },
        populateFilterControls: () => {
            if(DOMElements.selectZona) {
                DOMElements.selectZona.innerHTML = '<option value="">Filtro rápido por zona</option>';
                const sortedZonas = [...uniqueZonasSet].sort();
                sortedZonas.forEach(zona => DOMElements.selectZona.add(new Option(zona, zona)));
            }
            DataManager.updateLocalidadesDataList();
        },
        updateLocalidadesDataList: (selectedZona = '') => {
            if(DOMElements.localidadesDataList) {
                DOMElements.localidadesDataList.innerHTML = '';
                let localidadesToShow;
                if (selectedZona && allCourtsData.length > 0) {
                    localidadesToShow = new Set(allCourtsData.filter(c => c.zona === selectedZona).map(c => c.localidad));
                } else {
                    localidadesToShow = uniqueLocalidadesSet;
                }
                [...localidadesToShow].sort().forEach(loc => {
                    const option = document.createElement('option');
                    option.value = loc;
                    DOMElements.localidadesDataList.appendChild(option);
                });
            }
        },
        applyFilters: () => {
            if (!initialDataLoadedSuccessfully && allCourtsData.length === 0) { // No filtrar si no hay datos
                UI.updateCounters(); // Para que muestre 0 canchas
                return;
            }
            UI.clearMessages('info'); // Limpiar mensajes de "no resultados" previos
            const searchTerm = DOMElements.inputLocalidad ? DOMElements.inputLocalidad.value.toLowerCase().trim() : '';
            const selectedZona = DOMElements.selectZona ? DOMElements.selectZona.value : '';

            filteredCourtsData = allCourtsData.filter(court => {
                const matchLocalidad = !searchTerm || (court.localidad && court.localidad.toLowerCase().includes(searchTerm));
                const matchZona = !selectedZona || court.zona === selectedZona;
                return matchLocalidad && matchZona;
            });

            MapManager.renderMarkers();
            UI.updateCounters();
            MapManager.adjustViewToFilteredMarkers();
            LocalStorageManager.saveFilters({ localidad: searchTerm, zona: selectedZona });

            if (filteredCourtsData.length === 0 && (searchTerm || selectedZona)) {
                UI.displayMessage('No se encontraron canchas con los filtros aplicados.', 'info', 3000);
            }
        }
    };

    // --- GEOLOCALIZACIÓN ---
    const UserLocation = { /* ... (sin cambios respecto a la versión anterior) ... */ 
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
                    UI.updateCounters();
                    UI.displayMessage("Ubicación obtenida.", 'success', 3000);
                },
                (error) => {
                    UI.hideLoading();
                    currentUserLocation = null;
                    if (userLocationMarker && mapInstance) { mapInstance.removeLayer(userLocationMarker); userLocationMarker = null; }
                    UI.updateCounters();
                    let msg = "Error al obtener la ubicación: ";
                    switch (error.code) {
                        case error.PERMISSION_DENIED: msg += "Permiso denegado."; break;
                        case error.POSITION_UNAVAILABLE: msg += "Información no disponible."; break;
                        case error.TIMEOUT: msg += "Tiempo de espera agotado."; break;
                        default: msg += "Error desconocido."; break;
                    }
                    UI.displayMessage(msg, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }
    };
    
    // --- LOCALSTORAGE ---
    const LocalStorageManager = { /* ... (sin cambios respecto a la versión anterior) ... */ 
        saveFilters: (filters) => { try { localStorage.setItem('padelMap_filters', JSON.stringify(filters)); } catch (e) { console.warn("LS saveFilters error:", e); }},
        loadFilters: () => { try { const s = localStorage.getItem('padelMap_filters'); return s ? JSON.parse(s) : { localidad: '', zona: '' }; } catch (e) { console.warn("LS loadFilters error:", e); return { localidad: '', zona: '' }; }},
        saveMapView: (view) => { try { localStorage.setItem('padelMap_mapView', JSON.stringify(view)); } catch (e) { console.warn("LS saveMapView error:", e); }},
        getMapView: () => {
            try {
                const s = localStorage.getItem('padelMap_mapView');
                if (s) {
                    const p = JSON.parse(s);
                    if (p && typeof p.zoom === 'number' && p.center && typeof p.center.lat === 'number' && typeof p.center.lng === 'number') return p;
                }
            } catch (e) { console.warn("LS getMapView error:", e); }
            return DEFAULT_MAP_VIEW;
        }
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => { /* ... (sin cambios respecto a la versión anterior) ... */ 
        if(DOMElements.btnGetUserLocation) DOMElements.btnGetUserLocation.addEventListener('click', UserLocation.get);
        if(DOMElements.inputLocalidad) DOMElements.inputLocalidad.addEventListener('input', DataManager.applyFilters);
        if(DOMElements.selectZona) DOMElements.selectZona.addEventListener('change', () => {
            DataManager.updateLocalidadesDataList(DOMElements.selectZona.value);
            DataManager.applyFilters();
        });
        if(DOMElements.btnClearFilters) DOMElements.btnClearFilters.addEventListener('click', () => {
            if(DOMElements.inputLocalidad) DOMElements.inputLocalidad.value = '';
            if(DOMElements.selectZona) DOMElements.selectZona.value = '';
            DataManager.updateLocalidadesDataList();
            DataManager.applyFilters();
            if(mapInstance) mapInstance.setView(DEFAULT_MAP_VIEW.center, DEFAULT_MAP_VIEW.zoom);
            UI.clearMessages();
        });
    };

    // --- INICIALIZACIÓN ---
    const init = async () => {
        for (const elKey in DOMElements) {
            DOMElements[elKey] = document.getElementById(elKey);
            if (!DOMElements[elKey] && elKey !== 'localidadesDataList') {
                console.warn(`Elemento del DOM no encontrado: #${elKey}.`);
                if (elKey === 'mapContainer' || elKey === 'loadingOverlay') { // Críticos
                    document.body.innerHTML = `<p style="color:red; padding:20px;">Error crítico: Falta el elemento #${elKey}. La aplicación no puede iniciar.</p>`;
                    return;
                }
            }
        }
        if (!DOMElements.localidadesDataList && DOMElements.inputLocalidad) { // Si hay input pero no datalist
             console.warn("Datalist 'localidadesDataList' no encontrado, las sugerencias de localidad no funcionarán.");
        }


        if (!MapManager.init()) {
             UI.displayMessage("La inicialización del mapa falló. La aplicación no puede continuar.", "error");
             UI.hideLoading(); // Asegurar que el loading se oculte
             return;
        }

        const savedFilters = LocalStorageManager.loadFilters();
        if (DOMElements.inputLocalidad && savedFilters.localidad) DOMElements.inputLocalidad.value = savedFilters.localidad;
        
        await DataManager.loadAndProcessExcel(); // Carga datos y actualiza initialDataLoadedSuccessfully

        if (initialDataLoadedSuccessfully) {
            if (DOMElements.selectZona && savedFilters.zona && DOMElements.selectZona.querySelector(`option[value="${savedFilters.zona}"]`)) {
                DOMElements.selectZona.value = savedFilters.zona;
                DataManager.updateLocalidadesDataList(savedFilters.zona);
            }
            DataManager.applyFilters(); // Aplicar filtros iniciales
        } else {
             // Mensaje ya mostrado por loadAndProcessExcel si falló, o si estaba vacío
             // Forzar actualización de contadores a 0 si no hay datos.
            DataManager.applyFilters(); // Esto llamará a updateCounters
        }
        
        setupEventListeners();
        // UI.hideLoading(); // Ahora se gestiona principalmente dentro de loadAndProcessExcel y UserLocation.get
    };

    return { start: init };
})();

document.addEventListener('DOMContentLoaded', PadelApp.start);