const { createApp, ref, computed, onMounted, nextTick, reactive } = Vue;

createApp({
    setup() {
        // ==========================================
        // 1. АВТОРИЗАЦИЯ И СЕССИЯ
        // ==========================================
        const isAuthenticated = ref(false);
        const currentUser = ref(null);
        const loginForm = reactive({ username: '', password: '' });

        // Восстановление сессии при обновлении страницы
        onMounted(() => {
            const storedUser = localStorage.getItem('agro_user');
            if (storedUser) {
                currentUser.value = JSON.parse(storedUser);
                isAuthenticated.value = true;
                loadApiData(); // Грузим данные только если авторизованы
            }
        });

        const login = async () => {
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(loginForm)
                });
                
                if (!response.ok) throw new Error("Неверный логин или пароль");
                
                const user = await response.json();
                currentUser.value = user;
                isAuthenticated.value = true;
                
                // Сохраняем сессию
                localStorage.setItem('agro_user', JSON.stringify(user));
                loadApiData(); 
            } catch (e) {
                alert(e.message);
            }
        };

        const logout = () => {
            isAuthenticated.value = false;
            currentUser.value = null;
            loginForm.username = '';
            loginForm.password = '';
            varieties.value = [];
            localStorage.removeItem('agro_user');
        };

        // ==========================================
        // 2. БАЗОВОЕ СОСТОЯНИЕ
        // ==========================================
        const currentView = ref('directory'); 
        const previousView = ref('directory'); 
        const varieties = ref([]);
        const columns = ref([]);
        const selectedVariety = ref(null);
        const activeDetailTab = ref('main');
        const activeRootstockTab = ref(null);
        
        const isLoading = ref(false);
        const loadError = ref(false);
        const isModalOpen = ref(false);
        const modalMode = ref('add');
        const form = ref({});

        const filters = reactive({ search: '', group: '', category: '', sortField: 'name', sortDir: 'asc' });

        const setView = (view, variety = null) => {
            if (view === 'detail' || view === 'decision_graph_detail') {
                previousView.value = currentView.value;
            }
            currentView.value = view;
            if (variety) { 
                selectedVariety.value = variety; 
                activeDetailTab.value = 'main';
                if (variety.rootstocks && variety.rootstocks.length > 0) activeRootstockTab.value = variety.rootstocks[0]['Подвой'];
            }
        };

        // ==========================================
        // 3. УТИЛИТЫ И ФОРМАТИРОВАНИЕ
        // ==========================================
        const parseNumber = (val) => {
            if (!val) return 0;
            const num = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
            return isNaN(num) ? 0 : num;
        };

        const formatValue = (val) => {
            if (val === undefined || val === null || val === '') return '—';
            if (typeof val === 'number') return Number.isInteger(val) ? val : parseFloat(val.toFixed(2));
            const strVal = String(val).trim();
            if (/^-?\d+([.,]\d+)?$/.test(strVal)) {
                const num = parseFloat(strVal.replace(',', '.'));
                return Number.isInteger(num) ? num : parseFloat(num.toFixed(2));
            }
            return val;
        };

        const formatDateInternal = (val) => {
            if (!val || val === '—' || val === 'NaT' || val === 'nan') return '—';
            if (typeof val === 'number') {
                const d = new Date(Math.round((val - 25569) * 864e5));
                return dayjs(d).format('DD.MM.YYYY');
            }
            let s = String(val).trim();
            if (s.includes('-') && s.length >= 10) {
                const datePart = s.split(' ')[0]; 
                const parts = datePart.split('-');
                if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`; 
            }
            if (s.includes('.')) {
                let parts = s.split('.');
                if (parts.length === 2) return `${parts[0].padStart(2, '0')}.${parts[1].padEnd(2, '0')}`;
                if (parts.length === 3) return `${parts[0].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[2]}`;
            }
            return s;
        };

        const parseDateToTimestamp = (dateStr) => {
            if (!dateStr || dateStr === '—') return null;
            const formatted = formatDateInternal(dateStr);
            const [d, m, y] = formatted.split('.');
            if (!d || !m) return null;
            return new Date(y || 2026, parseInt(m) - 1, parseInt(d)).getTime();
        };

        const cleanPhaseName = (rawName) => rawName.split(',').pop().replace(/["_0-9]/g, '').trim();

        const getPhaseIcon = (phaseKey) => {
            if (!phaseKey) return 'fa-calendar-check';
            const p = phaseKey.toLowerCase();
            if (p.includes('покоя')) return 'fa-snowflake';
            if (p.includes('зеленый конус')) return 'fa-leaf';
            if (p.includes('мышиные ушки')) return 'fa-bug';
            if (p.includes('бутон')) return 'fa-seedling';
            if (p.includes('цветени')) return 'fa-sun';
            if (p.includes('завязь') || p.includes('лещина') || p.includes('орех')) return 'fa-circle-notch';
            if (p.includes('рост')) return 'fa-arrow-trend-up';
            if (p.includes('созревание')) return 'fa-apple-whole';
            if (p.includes('уборка')) return 'fa-truck-fast';
            return 'fa-calendar-check';
        };

        const getDynamicIcon = (key) => {
            const k = key.toLowerCase();
            if (k.includes('класс') || k.includes('категор')) return 'fa-award';
            if (k.includes('вес') || k.includes('масса') || k.includes('нагрузк')) return 'fa-weight-hanging';
            if (k.includes('калибр') || k.includes('размер') || k.includes('схема') || k.includes('площадь')) return 'fa-ruler-combined';
            if (k.includes('урожай') || k.includes('плод') || k.includes('сорт') || k.includes('подвой')) return 'fa-leaf';
            if (k.includes('мороз') || k.includes('холод') || k.includes('темпер')) return 'fa-temperature-low';
            if (k.includes('болезн') || k.includes('парш') || k.includes('гнил')) return 'fa-virus';
            if (k.includes('вредител') || k.includes('насеком')) return 'fa-bug';
            if (k.includes('brix') || k.includes('сахар') || k.includes('сладост')) return 'fa-cubes-stacked';
            if (k.includes('кислот')) return 'fa-lemon';
            if (k.includes('твердост') || k.includes('плотност')) return 'fa-dumbbell';
            if (k.includes('хранен') || k.includes('лежкост')) return 'fa-box-open';
            if (k.includes('срок') || k.includes('дата') || k.includes('дней')) return 'fa-calendar-days';
            if (k.includes('крахмал') || k.includes('индекс')) return 'fa-microscope';
            if (k.includes('окрас') || k.includes('цвет')) return 'fa-palette';
            if (k.includes('%') || k.includes('доля') || k.includes('выход')) return 'fa-chart-pie';
            if (k.includes('почв') || k.includes('земл') || k.includes('рельеф')) return 'fa-mountain';
            if (k.includes('вод') || k.includes('орошен') || k.includes('полив') || k.includes('влажн')) return 'fa-droplet';
            if (k.includes('опылител') || k.includes('цветени')) return 'fa-bee';
            return 'fa-circle-info';
        };

        // ==========================================
        // 4. API ЗАПРОСЫ К СЕРВЕРУ
        // ==========================================
        const loadApiData = async () => {
            isLoading.value = true;
            loadError.value = false;
            try {
                const response = await fetch('/api/varieties');
                if (!response.ok) throw new Error("API Error");
                
                const data = await response.json();
                
                const groupedVarieties = [];
                data.forEach(row => {
                    let existing = groupedVarieties.find(v => v['Сорт'] === row['Сорт']);
                    if (existing) {
                        if (row['Подвой'] !== '—') existing.rootstocks.push(row);
                    } else {
                        groupedVarieties.push({
                            ...row,
                            rootstocks: row['Подвой'] !== '—' ? [row] : []
                        });
                    }
                });

                varieties.value = groupedVarieties;
                if (data.length > 0) columns.value = Object.keys(data[0]).filter(k => k !== 'id' && k !== 'Название сорто-подвоя');
                isLoading.value = false;
            } catch (e) {
                console.error("Ошибка API:", e);
                loadError.value = true;
                isLoading.value = false;
            }
        };

        const saveVariety = async () => {
            if (currentUser.value?.role !== 'admin') return;
            try {
                const method = modalMode.value === 'add' ? 'POST' : 'PUT';
                const url = modalMode.value === 'add' ? '/api/varieties' : `/api/varieties/${form.value.id}`;
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(form.value)
                });

                if (!response.ok) throw new Error("Ошибка сервера");
                closeModal();
                await loadApiData(); 
            } catch(e) {
                alert("Ошибка при сохранении данных в базу.");
            }
        };

        const deleteVariety = async (variety) => {
            if (currentUser.value?.role !== 'admin') return;
            if (!confirm(`Вы уверены, что хотите удалить сорт "${variety['Сорт']}" из базы данных навсегда?`)) return;
            try {
                const response = await fetch(`/api/varieties/${variety.id}`, { method: 'DELETE' });
                if (!response.ok) throw new Error("Ошибка при удалении");
                await loadApiData(); 
            } catch(e) {
                alert("Не удалось удалить сорт.");
            }
        };

        const openModal = (mode, variety = null) => {
            modalMode.value = mode;
            let editForm = {};
            
            let sourceData = variety;
            if (variety && currentView.value === 'detail') {
                sourceData = extendedVarietyDetails.value;
            } else if (variety && variety.rootstocks && variety.rootstocks.length > 0) {
                sourceData = { ...variety, ...variety.rootstocks[0] };
            }

            columns.value.forEach(c => { 
                editForm[c] = sourceData ? (sourceData[c] !== undefined ? sourceData[c] : '') : ''; 
            });
            
            if (sourceData && sourceData.id) editForm.id = sourceData.id;
            
            form.value = editForm;
            isModalOpen.value = true;
        };

        const closeModal = () => { isModalOpen.value = false; };

        // ==========================================
        // 5. ФИЛЬТРАЦИЯ И СОРТИРОВКА
        // ==========================================
        const viewTitle = computed(() => ({ 
            'directory': 'Реестр сортов', 
            'cards': 'Витрина урожая', 
            'detail': selectedVariety.value ? selectedVariety.value['Сорт'] : 'Паспорт',
        })[currentView.value] || 'План-протоколы');

        const filteredAndSortedVarieties = computed(() => {
            let result = varieties.value;
            if (filters.search) {
                const q = filters.search.toLowerCase();
                result = result.filter(v => Object.values(v).some(val => val && String(val).toLowerCase().includes(q)));
            }
            if (filters.group) result = result.filter(v => v['Группа сорта'] === filters.group);
            if (filters.category) result = result.filter(v => v['Категория реализации'] === filters.category);

            result.sort((a, b) => {
                let valA = String(a['Сорт'] || ''), valB = String(b['Сорт'] || '');
                if (filters.sortField === 'brix') {
                    valA = parseNumber(a['BRIX (от), %']); valB = parseNumber(b['BRIX (от), %']);
                    return filters.sortDir === 'asc' ? valA - valB : valB - valA;
                }
                return filters.sortDir === 'asc' ? valA.localeCompare(valB, 'ru') : valB.localeCompare(valA, 'ru');
            });
            return result;
        });

        const uniqueGroups = computed(() => [...new Set(varieties.value.map(v => v['Группа сорта']).filter(Boolean))]);
        const uniqueCategories = computed(() => [...new Set(varieties.value.map(v => v['Категория реализации']).filter(Boolean))]);

        // ==========================================
        // 6. ПОДГОТОВКА ДАННЫХ ДЛЯ UI
        // ==========================================
        const extendedVarietyDetails = computed(() => {
            if (!selectedVariety.value) return {};
            const v = selectedVariety.value;
            let rootstockData = {};
            if (v.rootstocks && v.rootstocks.length > 0) {
                rootstockData = v.rootstocks.find(r => r['Подвой'] === activeRootstockTab.value) || v.rootstocks[0];
            }
            return { ...v, ...rootstockData }
        });

        const uiData = computed(() => {
            const v = extendedVarietyDetails.value;
            if (!v) return { calibers: [], classes: [], losses: [], immunity: [], starch: {} };

            const calLabels = ['55-60', '60-65', '65-70', '70-75', '75-80', '80-85', '85+'];
            const calColors = ['text-[#D5D0C5]', 'text-[#A8B29C]', 'text-[#7D9475]', 'text-brand-green', 'text-[#3D5C3A]', 'text-[#1e2a22]', 'text-brand-yellow'];
            const calibers = calLabels.map((l, i) => ({ label: l, value: parseNumber(v[l]), color: calColors[i] })).filter(c => c.value > 0);

            const classLabels = ['1 класс', '2 класс', '3 класс', '4 класс', '5 класс', '6 класс', 'е.у. ', '% индустриального яблока по валовке'];
            const classes = classLabels.map(l => {
                const cleanLabel = l.replace('% ', '').replace(' яблока по валовке', '');
                return { label: cleanLabel, value: parseNumber(v[l]) };
            }).filter(c => c.value > 0);

            const lossFields = ['Град, %', 'Гниль, %', 'Болезнь, %', 'Вредители, %', 'Критический недокалибр, %', 'Физиологический дефект, %', 'Перезрелость/незрелость, %', 'Иная причина, %'];
            const losses = lossFields.map(f => {
                const val = parseNumber(v[f]);
                return { label: f.replace(', %', ''), value: val, width: Math.min(val * 2, 100) };
            }).filter(l => l.value > 0).sort((a,b) => b.value - a.value);

            const immFields = {'Устойчивость к парше (1-3)': 'Парша', 'Устойчивость к мучнистой росе (1-3)': 'Мучнистая роса', 'Устойчивость к эрвинии (1-3)': 'Эрвиния', 'Устойчивость к глеоспориозу (1-3)': 'Глеоспориоз', 'Устойчивость к гнили семенной камеры (1-3)': 'Гниль'};
            const immunity = Object.keys(immFields).map(k => ({ label: immFields[k], value: parseNumber(v[k]) })).filter(i => i.value > 0);

            const starch = {
                start: parseNumber(v['Крахмал START (от), б']),
                optimum: parseNumber(v['Крахмал Optimum (от), б']),
                stop: parseNumber(v['Крахмал STOP (от), б'])
            };

            return { calibers, classes, losses, immunity, starch };
        });

        const HARDCODED_FIELDS = [
            'Сорт', 'Подвой', 'Группа сорта', 'Категория сорта', 'Покровная окраска', 'Категория реализации', 'Сад укрупненно',
            'Тип почвы', 'Рельеф', 'Тип орошения', 'Группа созревания', 'BRIX (от), %', 'Кислотность (от), г/л', 'Твердость, кг/см2', 'Поведение при хранении (до) (CA/ULO мес.)',
            'Средний калибр яблока (от), мм', 'Средний калибр яблока (до), мм', 'Средний вес (от), г', 'Средний вес (до), г',
            '55-60', '60-65', '65-70', '70-75', '75-80', '80-85', '85+', '1 класс', '2 класс', '3 класс', '4 класс', '5 класс', '6 класс', 'е.у. ', '% индустриального яблока по валовке',
            'Град, %', 'Гниль, %', 'Болезнь, %', 'Вредители, %', 'Критический недокалибр, %', 'Физиологический дефект, %', 'Перезрелость/незрелость, %', 'Иная причина, %',
            'Устойчивость к парше (1-3)', 'Устойчивость к мучнистой росе (1-3)', 'Устойчивость к эрвинии (1-3)', 'Устойчивость к глеоспориозу (1-3)', 'Устойчивость к гнили семенной камеры (1-3)',
            'Крахмал START (от), б', 'Крахмал Optimum (от), б', 'Крахмал STOP (от), б', 'Уборка плодов - дата начала', 'Уборка плодов - дата окончания'
        ];

        const groupLogic = (keysArray, dataObject, isForDisplay = false) => {
            const groups = {
                'Идентификация и Селекция': [], 'Агрономия и Посадка': [], 'Качество и Свойства плодов': [],
                'Дополнительная аналитика': [], 'Сводка фенофаз': []
            };
            const datesMap = new Map();
            
            keysArray.forEach(key => {
                const kl = key.toLowerCase();
                const fieldVal = dataObject ? dataObject[key] : '';
                if (fieldVal === undefined || fieldVal === null) return;
                const fieldInfo = { key, value: fieldVal };

                if (kl.includes(' - дата')) {
                    if (!dataObject) { groups['Сводка фенофаз'].push(fieldInfo); return; }
                    const baseName = cleanPhaseName(key.split(' - ')[0]);
                    const isStart = kl.includes('начала');
                    if (!datesMap.has(baseName)) datesMap.set(baseName, { start: '—', end: '—' });
                    if (isStart) datesMap.get(baseName).start = fieldVal;
                    else datesMap.get(baseName).end = fieldVal;
                    return;
                }

                if (isForDisplay && HARDCODED_FIELDS.includes(key)) return;

                if (kl.includes('селекционер') || kl.includes('производител') || kl.includes('страна') || kl.includes('потенциал') || kl.includes('канал') || kl.includes('sku')) {
                    groups['Идентификация и Селекция'].push(fieldInfo);
                } else if (kl.includes('урожайност') || kl.includes('морозо') || kl.includes('совместимост') || kl.includes('опылител') || kl.includes('схема') || kl.includes('площадь') || kl.includes('деревьев') || kl.includes('нагрузк') || kl.includes('кроны') || kl.includes('плодоношен')) {
                    groups['Агрономия и Посадка'].push(fieldInfo);
                } else if (kl.includes('окраск') || kl.includes('форма') || kl.includes('плотност') || kl.includes('зрелост') || kl.includes('нажим') || kl.includes('целевая масса') || kl.includes('сбор') || kl.includes('дельта')) {
                    groups['Качество и Свойства плодов'].push(fieldInfo);
                } else {
                    groups['Дополнительная аналитика'].push(fieldInfo);
                }
            });

            if (dataObject && isForDisplay) {
                datesMap.forEach((dates, baseName) => {
                    if(dates.start !== '—' || dates.end !== '—') {
                        groups['Сводка фенофаз'].push({ 
                            key: `ФЕНОФАЗА: ${baseName.toUpperCase()}`, 
                            value: `${formatDateInternal(dates.start)} - ${formatDateInternal(dates.end)}` 
                        });
                    }
                });
            }
            
            Object.keys(groups).forEach(k => { if(groups[k].length === 0) delete groups[k]; });
            return groups;
        };

        const groupedDetails = computed(() => extendedVarietyDetails.value ? groupLogic(columns.value, extendedVarietyDetails.value, true) : {});
        const groupedFormFields = computed(() => groupLogic(columns.value, null, false));

        // ==========================================
        // 7. ДИНАМИЧЕСКИЙ КАЛЕНДАРЬ ФЕНОФАЗ
        // ==========================================
        const currentCalendarDate = ref(dayjs()); 
        
        const calendarMonthName = computed(() => currentCalendarDate.value.format('MMMM YYYY'));
        const daysInMonth = computed(() => currentCalendarDate.value.daysInMonth());
        
        const firstDayOffset = computed(() => {
            let d = currentCalendarDate.value.startOf('month').day();
            return d === 0 ? 6 : d - 1; 
        });

        const prevMonth = () => { currentCalendarDate.value = currentCalendarDate.value.subtract(1, 'month'); };
        const nextMonth = () => { currentCalendarDate.value = currentCalendarDate.value.add(1, 'month'); };
        
        const isToday = (day) => {
            const now = dayjs();
            return day === now.date() && currentCalendarDate.value.month() === now.month() && currentCalendarDate.value.year() === now.year();
        };

        const getActivePhaseForDay = (dayNum) => {
            if(!extendedVarietyDetails.value) return null;
            const checkTime = currentCalendarDate.value.date(dayNum).hour(12).valueOf();
            
            for (const [key, value] of Object.entries(extendedVarietyDetails.value)) {
                if (key.includes(' - дата начала')) {
                    const startStr = formatDateInternal(value);
                    const endKey = key.replace('дата начала', 'дата окончания');
                    const endStr = formatDateInternal(extendedVarietyDetails.value[endKey]);
                    
                    if (startStr === '—' || endStr === '—') continue;
                    
                    const [sD, sM, sY] = startStr.split('.');
                    const [eD, eM, eY] = endStr.split('.');
                    
                    const start = new Date(sY || 2026, parseInt(sM)-1, sD).getTime();
                    const end = new Date(eY || 2026, parseInt(eM)-1, eD, 23, 59, 59).getTime();
                    
                    if (checkTime >= start && checkTime <= end) {
                        return cleanPhaseName(key.split(' - ')[0]);
                    }
                }
            }
            return null;
        };

        const calendarSummaryDuration = computed(() => {
            const start = extendedVarietyDetails.value['Уборка плодов - дата начала'];
            const end = extendedVarietyDetails.value['Уборка плодов - дата окончания'];
            if(start && end && start !== '—' && end !== '—') {
                const ts1 = parseDateToTimestamp(start);
                const ts2 = parseDateToTimestamp(end);
                if(ts1 && ts2) return Math.round((ts2 - ts1) / (1000 * 60 * 60 * 24));
            }
            return 15;
        });

        // ==========================================
        // 8. ГРАФ РЕШЕНИЙ И РЕГЛАМЕНТЫ
        // ==========================================
        const decisionGraphNodes = computed(() => {
            if (!extendedVarietyDetails.value) return [];
            const nodes = [];
            const datesMap = new Map();
            columns.value.forEach(key => {
                if (key.toLowerCase().includes(' - дата')) {
                    const baseName = cleanPhaseName(key.split(' - ')[0]);
                    if (!datesMap.has(baseName)) datesMap.set(baseName, { name: baseName, start: '—', end: '—' });
                    if (key.toLowerCase().includes('начала')) datesMap.get(baseName).start = extendedVarietyDetails.value[key] || '—';
                    else datesMap.get(baseName).end = extendedVarietyDetails.value[key] || '—';
                }
            });

            datesMap.forEach(v => {
                let risks = [];
                if (v.name === 'Состояние покоя') {
                    risks.push({ type: 'Природные', name: 'Резкие заморозки', condition: '-28°C ... -20°C', desc: 'Критическое понижение температуры.', operations: [{ name: 'Обрезка деревьев санитарная', type: 'Механическая', volume: '50-100%', duration: '3-7 дней', instruction: 'Срез веток на отращивание.' }] });
                }
                nodes.push({ phase: v.name, startFormatted: formatDateInternal(v.start), endFormatted: formatDateInternal(v.end), risks: risks });
            });
            return nodes;
        });
        
        const activeProtocolCategory = ref('Все');
        const protocols = [
            { category: 'Климат', threat: 'Резкие заморозки', phase: 'Состояние покоя', condition: '-28°C ... -20°C', desc: 'Критическое понижение температуры.', action: 'Санитарная обрезка'},
            { category: 'Болезни', threat: 'Эпифитотия парши', phase: 'Мышиные ушки', condition: 'Влажность > 80%', desc: 'Активный выброс аскоспор парши.', action: 'Превентивное опрыскивание'}
        ];
        const filteredProtocols = computed(() => activeProtocolCategory.value === 'Все' ? protocols : protocols.filter(p => p.category === activeProtocolCategory.value));
        const getProtocolColor = (cat) => cat === 'Климат' ? 'bg-blue-500' : 'bg-brand-green';
        const getProtocolBadgeClass = (cat) => cat === 'Климат' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-brand-green/10 text-brand-green border-brand-green/20';
        const getProtocolIcon = (cat) => cat === 'Климат' ? 'fa-cloud-sun-rain text-blue-500' : 'fa-virus text-brand-green';
        const selectedGraphPhase = ref(null);

        // ==========================================
        // ЭКСПОРТ ВСЕХ ФУНКЦИЙ (Включая parseNumber!)
        // ==========================================
        return {
            isAuthenticated, currentUser, loginForm, login, logout,
            currentView, previousView, varieties, selectedVariety, extendedVarietyDetails, activeRootstockTab, uiData, viewTitle, 
            isLoading, loadError, filters, form, isModalOpen, modalMode, 
            uniqueGroups, uniqueCategories, filteredAndSortedVarieties, groupedFormFields, groupedDetails,
            
            calendarMonthName, daysInMonth, firstDayOffset, prevMonth, nextMonth, isToday, getActivePhaseForDay, calendarSummaryDuration,
            
            decisionGraphNodes, selectedGraphPhase, activeProtocolCategory, filteredProtocols, getProtocolColor, getProtocolBadgeClass, getProtocolIcon, activeDetailTab,
            
            // Здесь добавлены ВСЕ нужные шаблону функции:
            setView, parseNumber, formatValue, formatDateInternal, getDynamicIcon, getPhaseIcon, loadApiData,
            openModal, closeModal, saveVariety, deleteVariety
        }
    }
}).mount('#app');