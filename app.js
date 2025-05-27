const PadelApp = (() => {
    // --- CONSTANTES DE CONFIGURACIÓN ---
    const EXCEL_FILE_PATH = './Padel2.xlsx'; // Asegúrate que este archivo esté en la misma carpeta que index.html
    const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search';
    // ¡IMPORTANTE! CAMBIA ESTA LÍNEA POR UN USER AGENT ÚNICO Y VÁLIDO (EJ. NOMBREAPP/VERSION (TU_EMAIL_O_CONTACTO))
    const NOMINATIM_USER_AGENT = 'PadelCourtFinderApp/1.0 (https://github.com/tu_usuario/tu_repo_o_email)';
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
            // 'k' es el nombre de la columna (ej. 'Latitud', 'lat') que se está probando
            const foundKey = potentialKeys.find(k => row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '');
            // Si se encontró una clave válida (foundKey no es undefined), se usa esa clave para obtener el valor de la fila.
            return foundKey ? String(row[foundKey]).trim() : undefined;
        },
        // debounce: (func, delay) => { /* ...código de debounce... */ }
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
                DOMElements.messageArea.innerHTML = '';
                DOMElements.messageArea.appendChild(messageDiv);
                if (duration > 0) {
                    setTimeout(() => {
                        if (messageDiv.parentNode === DOMElements.messageArea) {
                           DOMElements.messageArea.innerHTML = '';
                        }
                    }, duration);
                }
            }
        },
        clearMessages: () => { if (DOMElements.messageArea) DOMElements.messageArea.innerHTML = ''; },
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
                return false; // Indicar fallo
            }
            mapInstance = L.map(DOMElements.mapContainer);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(mapInstance);

            markerClusterGroup = L.markerClusterGroup();
            mapInstance.addLayer(markerClusterGroup);

            const savedView = LocalStorageManager.getMapView();
            mapInstance.setView(savedView.center, savedView.zoom);
            
            mapInstance.on('moveend zoomend', () => {
                LocalStorageManager.saveMapView({ center: mapInstance.getCenter(), zoom: mapInstance.getZoom() });
            });
            return true; // Indicar éxito
        },
        renderMarkers: () => {
            if (!markerClusterGroup || !L.AwesomeMarkers) {
                console.error("MarkerClusterGroup o AwesomeMarkers no están inicializados.");
                return;
            }
            markerClusterGroup.clearLayers();
            const canchaIcon = L.AwesomeMarkers.icon({ icon: 'table-tennis-paddle-ball', prefix: 'fas', markerColor: 'green', iconColor: 'white' });

            filteredCourtsData.forEach(court => {
                if (typeof court.lat !== 'number' || typeof court.lng !== 'number' || isNaN(court.lat) || isNaN(court.lng)) {
                    console.warn('Marcador omitido por lat/lng inválido:', court.nombre, court);
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
            if (!mapInstance) return;
            if (filteredCourtsData.length === 0) {
                 // No hacer zoom si no hay resultados tras un filtro
                return;
            }
            if (filteredCourtsData.length === 1 && filteredCourtsData[0].lat && filteredCourtsData[0].lng) {
                mapInstance.setView([filteredCourtsData[0].lat, filteredCourtsData[0].lng], SINGLE_MARKER_ZOOM);
            } else {
                const validCoords = filteredCourtsData.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number');
                if (validCoords.length > 0) {
                    const bounds = L.latLngBounds(validCoords.map(c => [c.lat, c.lng]));
                    if (bounds.isValid()) {
                        mapInstance.fitBounds(bounds, { padding: [50, 50] });
                    }
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
            try {
                const response = await fetch(EXCEL_FILE_PATH);
                if (!response.ok) throw new Error(`No se pudo cargar el archivo Excel (${response.status} ${response.statusText})`);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) throw new Error("El archivo Excel no contiene hojas.");
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                if (!rows.length) {
                    UI.displayMessage('El archivo Excel está vacío o no tiene el formato esperado.', 'warning');
                    return;
                }

                const geocodingPromises = [];
                let courtsProcessed = 0;

                for (const row of rows) {
                    courtsProcessed++;
                    UI.showLoading(`Procesando cancha ${courtsProcessed} de ${rows.length}...`);
                    
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
                        lat, lng
                    };

                    if (!isNaN(lat) && !isNaN(lng)) {
                        allCourtsData.push(court);
                        if(localidad !== 'Sin localidad') uniqueLocalidadesSet.add(localidad);
                        if(zona !== 'Sin zona') uniqueZonasSet.add(zona);
                    } else if (direccion !== 'Dirección no disponible' && localidad !== 'Sin localidad') {
                        geocodingPromises.push(
                            DataManager.geocodeAddress(`${direccion}, ${localidad}, Buenos Aires, Argentina`)
                                .then(geoCoords => {
                                    if (geoCoords) {
                                        court.lat = geoCoords.lat;
                                        court.lng = geoCoords.lng;
                                        allCourtsData.push(court);
                                        if(localidad !== 'Sin localidad') uniqueLocalidadesSet.add(localidad);
                                        if(zona !== 'Sin zona') uniqueZonasSet.add(zona);
                                    } else {
                                        console.warn(`No se pudo geocodificar: ${nombre} en ${direccion}, ${localidad}`);
                                    }
                                }).catch(err => console.error(`Error en promesa de geocodificación para ${nombre}:`, err))
                        );
                        // Control de tasa para Nominatim
                        if (geocodingPromises.length >= 5) { // Procesar en lotes
                            UI.showLoading(`Geocodificando lote de ${geocodingPromises.length} direcciones...`);
                            await Promise.all(geocodingPromises.splice(0, geocodingPromises.length)); // Procesar todas las actuales y vaciar
                            await new Promise(resolve => setTimeout(resolve, 1100)); // Pausa > 1s por política de Nominatim
                        }
                    } else {
                         console.warn(`Cancha '${nombre}' omitida por falta de lat/lng y dirección/localidad completa.`);
                    }
                }
                
                if (geocodingPromises.length > 0) { // Procesar promesas restantes
                    UI.showLoading(`Finalizando geocodificación de ${geocodingPromises.length} direcciones...`);
                    await Promise.all(geocodingPromises);
                }

                DataManager.populateFilterControls();
                UI.displayMessage(`Se cargaron ${allCourtsData.length} canchas.`, 'success', 4000);

            } catch (error) {
                console.error("Error cargando o procesando Excel:", error);
                UI.displayMessage(`Error al cargar datos: ${error.message}. Revisa la consola para más detalles.`, 'error');
                allCourtsData = [];
            } finally {
                UI.hideLoading();
            }
        },
        geocodeAddress: async (address) => {
            try {
                const url = `${NOMINATIM_API_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
                const response = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Error de Nominatim (${response.status}): ${errorText} para la dirección: ${address}`);
                    // Si es 429 (Too Many Requests), podríamos intentar reintentar con backoff exponencial (más avanzado)
                    return null;
                }
                const data = await response.json();
                if (data && data.length > 0 && data[0].lat && data[0].lon) {
                    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                }
                console.warn(`Nominatim no devolvió coordenadas para: ${address}`, data);
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
            UI.clearMessages();
            const searchTerm = DOMElements.inputLocalidad ? DOMElements.inputLocalidad.value.toLowerCase().trim() : '';
            const selectedZona = DOMElements.selectZona ? DOMElements.selectZona.value : '';

            if (allCourtsData.length === 0 && !UI.loadingOverlay.classList.contains('hidden')) {
                // No aplicar filtros si los datos aún no se han cargado (o fallaron)
                return;
            }

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
    const LocalStorageManager = {
        saveFilters: (filters) => { try { localStorage.setItem('padelMap_filters', JSON.stringify(filters)); } catch (e) { console.warn("LS saveFilters error:", e); }},
        loadFilters: () => { try { const s = localStorage.getItem('padelMap_filters'); return s ? JSON.parse(s) : { l: '', z: '' }; } catch (e) { console.warn("LS loadFilters error:", e); return { l: '', z: '' }; }},
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
    const setupEventListeners = () => {
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
            if (!DOMElements[elKey] && elKey !== 'localidadesDataList') { // datalist es opcional si el input no existe
                console.warn(`Elemento del DOM no encontrado: #${elKey}. Algunas funciones podrían no estar disponibles.`);
                if (elKey === 'mapContainer' || elKey === 'loadingOverlay') {
                    document.body.innerHTML = `<p style="color:red; padding:20px;">Error crítico: Falta el elemento #${elKey}. La aplicación no puede iniciar.</p>`;
                    return;
                }
            }
        }
        DOMElements.localidadesDataList = document.getElementById('localidadesDataList'); // Re-asignar por si el ID es diferente

        if (!MapManager.init()) { // Si el mapa no se pudo inicializar, detener.
             return;
        }

        const savedFilters = LocalStorageManager.loadFilters();
        if (DOMElements.inputLocalidad && savedFilters.localidad) DOMElements.inputLocalidad.value = savedFilters.localidad;
        
        await DataManager.loadAndProcessExcel();

        if (DOMElements.selectZona && savedFilters.zona && DOMElements.selectZona.querySelector(`option[value="${savedFilters.zona}"]`)) {
            DOMElements.selectZona.value = savedFilters.zona;
            DataManager.updateLocalidadesDataList(savedFilters.zona);
        }
        
        DataManager.applyFilters();
        setupEventListeners();
        // UI.hideLoading(); // Se maneja dentro de loadAndProcessExcel y UserLocation.get
    };

    return { start: init };
})();

document.addEventListener('DOMContentLoaded', PadelApp.start);