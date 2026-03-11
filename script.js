import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    getDoc,
    doc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// FIX #1: La API Key debe tener restricción de dominio en Google Cloud Console
// https://console.cloud.google.com → Credenciales → Restricciones de la API Key
const firebaseConfig = {
    apiKey: "AIzaSyArmhy141BBuYQNKnIqILg0_7fGf5Nul2E",
    authDomain: "sintegra-store.firebaseapp.com",
    projectId: "sintegra-store",
    storageBucket: "sintegra-store.firebasestorage.app",
    messagingSenderId: "795975627623",
    appId: "1:795975627623:web:f790f64b5ca94b327cf5c2",
    measurementId: "G-8DXD7B4PP4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allWebs = [];
let allCategories = new Set();
let citasPendientes = 0;

// FIX #5: Rate limiting para el formulario de citas
let lastCitaSubmit = 0;
const CITA_COOLDOWN_MS = 60 * 1000; // 1 minuto entre envíos

// FIX #4: Función de escape de HTML para prevenir XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

// FIX #6: Validar esquema de cita antes de enviar a Firebase
function validateCita(cita) {
    const errors = [];

    if (!cita.customer.name || cita.customer.name.trim().length < 2) {
        errors.push('El nombre debe tener al menos 2 caracteres.');
    }
    if (cita.customer.name.length > 100) {
        errors.push('El nombre es demasiado largo.');
    }
    if (!cita.customer.contact || cita.customer.contact.trim().length < 7) {
        errors.push('El teléfono debe tener al menos 7 dígitos.');
    }
    if (cita.customer.contact.length > 20) {
        errors.push('El teléfono es demasiado largo.');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cita.customer.email || !emailRegex.test(cita.customer.email)) {
        errors.push('El correo electrónico no es válido.');
    }
    if (!cita.date) {
        errors.push('Debes seleccionar una fecha.');
    }
    // Verificar que la fecha no sea en el pasado
    const selectedDate = new Date(cita.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
        errors.push('La fecha no puede ser en el pasado.');
    }
    if (!cita.time) {
        errors.push('Debes seleccionar una hora.');
    }
    if (cita.message && cita.message.length > 500) {
        errors.push('El mensaje no puede superar los 500 caracteres.');
    }

    return errors;
}

function getWebScreenshotUrl(url) {
    return `https://image.thum.io/get/width/600/crop/800/${encodeURIComponent(url)}`;
}

async function renderStore() {
    const grid = document.getElementById('websGrid');
    if (!grid) return;

    try {
        const snap = await getDocs(collection(db, "webs"));
        grid.innerHTML = "";
        allWebs = [];
        allCategories.clear();

        if (snap.empty) {
            grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1">No hay webs disponibles</p>';
            return;
        }

        snap.forEach(docSnap => {
            const w = docSnap.data();
            w.id = docSnap.id;
            allWebs.push(w);
            allCategories.add(w.category);

            const previewUrl = getWebScreenshotUrl(w.url);

            // FIX #4: escapeHTML en todos los datos de Firebase antes de insertar al DOM
            const card = document.createElement('div');
            card.className = 'product-card glass-panel';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Ver detalles de ${escapeHTML(w.name)}`);
            card.addEventListener('click', () => openWebModal(docSnap.id));
            card.innerHTML = `
                <div class="card-img-container">
                    <img src="${escapeHTML(previewUrl)}" alt="Preview de ${escapeHTML(w.name)}" loading="lazy"
                        onerror="this.src='https://via.placeholder.com/400x300/0d2847/00d4ff?text=Vista+Previa'">
                    <div class="web-preview-badge">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                        Preview
                    </div>
                </div>
                <div class="card-info">
                    <span class="card-category">${escapeHTML(w.category)}</span>
                    <h3>${escapeHTML(w.name)}</h3>
                </div>
                <a href="${escapeHTML(w.url)}" target="_blank" rel="noopener noreferrer"
                    class="view-web-btn" title="Ver Web"
                    onclick="event.stopPropagation();"
                    aria-label="Abrir ${escapeHTML(w.name)} en nueva pestaña">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                </a>`;
            grid.appendChild(card);
        });

        updateCategorySelect();
    } catch (error) {
        // FIX #12: Sin detalles de error en producción
        grid.innerHTML = '<p style="text-align:center;color:#ef4444;grid-column:1/-1">Error al cargar las webs. Intenta recargar la página.</p>';
    }
}

function updateCategorySelect() {
    const select = document.getElementById('categorySelect');
    if (!select) return;
    const currentValue = select.value;
    let html = '<option value="all">Todas las Categorías</option>';
    allCategories.forEach(cat => {
        html += `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`;
    });
    select.innerHTML = html;
    select.value = currentValue;
}

window.filterByCategory = function (category) {
    const grid = document.getElementById('websGrid');
    if (!grid) return;
    grid.innerHTML = "";

    // FIX #4: validar que category sea un valor conocido
    const validCategory = category === 'all' ? 'all' : [...allCategories].find(c => c === category) || 'all';
    const filtered = validCategory === 'all' ? allWebs : allWebs.filter(w => w.category === validCategory);

    if (filtered.length === 0) {
        grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1">No hay webs en esta categoría</p>';
        return;
    }

    filtered.forEach(w => {
        const previewUrl = getWebScreenshotUrl(w.url);
        const card = document.createElement('div');
        card.className = 'product-card glass-panel';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', () => openWebModal(w.id));
        card.innerHTML = `
            <div class="card-img-container">
                <img src="${escapeHTML(previewUrl)}" alt="Preview de ${escapeHTML(w.name)}" loading="lazy"
                    onerror="this.src='https://via.placeholder.com/400x300/0d2847/00d4ff?text=Vista+Previa'">
                <div class="web-preview-badge">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    Preview
                </div>
            </div>
            <div class="card-info">
                <span class="card-category">${escapeHTML(w.category)}</span>
                <h3>${escapeHTML(w.name)}</h3>
            </div>
            <a href="${escapeHTML(w.url)}" target="_blank" rel="noopener noreferrer"
                class="view-web-btn" title="Ver Web"
                onclick="event.stopPropagation();"
                aria-label="Abrir ${escapeHTML(w.name)} en nueva pestaña">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>`;
        grid.appendChild(card);
    });
};

window.openWebModal = function (webId) {
    const w = allWebs.find(web => web.id === webId);
    if (!w) return;

    const previewUrl = getWebScreenshotUrl(w.url);
    const modalImage = document.getElementById('modalImage');
    modalImage.src = previewUrl;
    modalImage.onerror = function () {
        this.src = 'https://via.placeholder.com/600x400/0d2847/00d4ff?text=Vista+Previa+No+Disponible';
    };

    // FIX #4: Usar textContent para datos dinámicos, nunca innerHTML
    document.getElementById('modalCategory').textContent = w.category;
    document.getElementById('modalTitle').textContent = w.name;
    document.getElementById('modalDescription').textContent = w.description || "Sin descripción disponible";

    // FIX #4: Validar URL antes de asignar al href
    const safeUrl = w.url.startsWith('http://') || w.url.startsWith('https://') ? w.url : '#';
    document.getElementById('viewWebBtn').href = safeUrl;

    document.getElementById('webModal').classList.add('active');
};

window.closeModal = function (modalId) {
    const validModals = ['webModal', 'citaModal'];
    if (validModals.includes(modalId)) {
        document.getElementById(modalId).classList.remove('active');
    }
};

function showNotification(message, type = 'success') {
    // FIX #4: Usar textContent para evitar XSS en notificaciones
    const notif = document.createElement('div');
    const bgColor = type === 'success' ? 'var(--primary)' : '#ef4444';
    notif.style.cssText = `position:fixed;bottom:20px;right:20px;background:${bgColor};color:white;padding:1rem 1.5rem;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:9999;animation:slideIn 0.3s ease;font-weight:500;max-width:300px;`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

async function loadVisionMission() {
    const missionContent = document.getElementById('missionContent');
    const visionContent = document.getElementById('visionContent');
    if (!missionContent || !visionContent) return;

    try {
        const [misionDoc, visionDoc] = await Promise.all([
            getDoc(doc(db, "visionMision", "mision")),
            getDoc(doc(db, "visionMision", "vision"))
        ]);

        const missionText = misionDoc.exists() ? (misionDoc.data().content || "") : "";
        const visionText = visionDoc.exists() ? (visionDoc.data().content || "") : "";

        // FIX #4: textContent en vez de innerHTML para datos de Firebase
        if (missionText.trim()) {
            missionContent.textContent = missionText;
        } else {
            missionContent.innerHTML = '<span class="vision-mission-placeholder">Misión no definida aún</span>';
        }

        if (visionText.trim()) {
            visionContent.textContent = visionText;
        } else {
            visionContent.innerHTML = '<span class="vision-mission-placeholder">Visión no definida aún</span>';
        }

        adjustVisionMissionHeights();
    } catch {
        // FIX #12: Sin detalles de error internos en producción
        missionContent.innerHTML = '<span class="vision-mission-placeholder">No disponible</span>';
        visionContent.innerHTML = '<span class="vision-mission-placeholder">No disponible</span>';
    }
}

function adjustVisionMissionHeights() {
    const missionCard = document.querySelector('.vision-mission-card.mission');
    const visionCard = document.querySelector('.vision-mission-card.vision');
    if (missionCard && visionCard && window.innerWidth >= 768) {
        missionCard.style.height = 'auto';
        visionCard.style.height = 'auto';
        const maxHeight = Math.max(missionCard.offsetHeight, visionCard.offsetHeight, 200);
        missionCard.style.minHeight = maxHeight + 'px';
        visionCard.style.minHeight = maxHeight + 'px';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderStore();
    loadVisionMission();

    window.addEventListener('resize', adjustVisionMissionHeights);

    document.getElementById('openCitasBtn')?.addEventListener('click', () => {
        document.getElementById('citaModal').classList.add('active');
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    document.getElementById('citaForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        // FIX #5: Rate limiting en el cliente
        const now = Date.now();
        if (now - lastCitaSubmit < CITA_COOLDOWN_MS) {
            const remaining = Math.ceil((CITA_COOLDOWN_MS - (now - lastCitaSubmit)) / 1000);
            showNotification(`Por favor espera ${remaining} segundos antes de enviar otra solicitud.`, 'error');
            return;
        }

        const cita = {
            customer: {
                name: document.getElementById('cName').value.trim(),
                contact: document.getElementById('cContact').value.trim(),
                email: document.getElementById('cEmail').value.trim().toLowerCase()
            },
            date: document.getElementById('cDate').value,
            time: document.getElementById('cTime').value,
            message: document.getElementById('cMessage').value.trim(),
            status: 'pendiente',
            createdAt: new Date().toISOString() // FIX: ISO format más confiable que toLocaleString
        };

        // FIX #6: Validar esquema antes de enviar
        const errors = validateCita(cita);
        if (errors.length > 0) {
            showNotification(errors[0], 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';

        try {
            await addDoc(collection(db, "citas"), cita);
            lastCitaSubmit = Date.now(); // FIX #5: Actualizar timestamp tras envío exitoso
            showNotification('¡Cita solicitada exitosamente! Te contactaremos pronto.');
            closeModal('citaModal');
            e.target.reset();
            citasPendientes++;
            updateCitaCount();
        } catch {
            showNotification('Error al solicitar la cita. Intenta nuevamente.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '✅ Solicitar Cita';
        }
    });

    const dateInput = document.getElementById('cDate');
    if (dateInput) {
        dateInput.min = new Date().toISOString().split('T')[0];
    }
});

function updateCitaCount() {
    const count = document.getElementById('citaCount');
    if (count) {
        count.textContent = citasPendientes;
        count.style.display = citasPendientes > 0 ? 'flex' : 'none';
    }
}

document.getElementById('footerYear').textContent = new Date().getFullYear();

// Animaciones de notificación
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
`;
document.head.appendChild(style);
