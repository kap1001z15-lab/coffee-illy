<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Терминал Бариста — Coffee ERP</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen font-sans pb-10">

  <header class="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-10">
    <div class="flex justify-between items-center mb-3">
      <div>
        <h1 class="text-lg font-bold text-amber-400">☕ Coffee ERP</h1>
        <p id="userInfo" class="text-xs text-slate-400">Точка: Центральная | Бариста</p>
      </div>
      <select id="blockSelector" onchange="selectBlock(this.value)" class="bg-slate-700 text-sm rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none">
        <option value="Открытие">🌅 Открытие</option>
        <option value="Закрытие">🌙 Закрытие</option>
        <option value="КАССА">💰 Авто-Касса</option>
      </select>
    </div>
    <div id="progressBarContainer" class="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
      <div id="progressBar" class="bg-amber-400 h-full transition-all duration-300" style="width: 0%"></div>
    </div>
  </header>

  <main class="p-4 max-w-md mx-auto">
    <div id="loader" class="text-center py-16">
      <div class="animate-spin h-10 w-10 border-4 border-amber-400 border-t-transparent rounded-full mx-auto mb-4"></div>
      <p class="text-slate-400 text-sm">Синхронизация...</p>
    </div>

    <!-- ЭКРАН 1: ЧЕК-ЛИСТ -->
    <div id="checklistView" class="hidden space-y-4">
      <div class="flex justify-between items-center text-xs text-slate-400">
        <span id="stepCounter">Шаг 1 из 5</span>
      </div>
      <div class="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-4">
        <h2 id="taskTitle" class="text-xl font-bold leading-snug">Название</h2>
        <p id="taskInstruction" class="text-sm text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-700/60"></p>

        <div id="photoBlock" class="space-y-2">
          <label class="block text-xs font-semibold uppercase text-amber-400">📸 Обязательное фото:</label>
          <label class="flex flex-col items-center justify-center border-2 border-dashed border-slate-600 rounded-xl p-4 cursor-pointer bg-slate-900/40">
            <span id="photoPrompt" class="text-sm text-slate-300">Нажми, чтобы открыть камеру</span>
            <img id="photoPreview" class="hidden max-h-48 rounded-lg mt-2 object-cover" />
            <input type="file" id="cameraInput" accept="image/*" capture="environment" class="hidden" onchange="handlePhoto(event)">
          </label>
        </div>

        <div class="pt-2 space-y-2">
          <label class="block text-xs text-slate-400">Результат проверки:</label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="btnOk" onclick="setStepStatus(false)" class="py-2.5 rounded-xl text-sm border border-emerald-500 bg-emerald-500/20 text-emerald-300">✅ В норме</button>
            <button type="button" id="btnIncident" onclick="setStepStatus(true)" class="py-2.5 rounded-xl text-sm border border-slate-600 bg-slate-700/40 text-slate-300">⚠️ Поломка</button>
          </div>
        </div>
        <div id="incidentBox" class="hidden space-y-2 pt-2">
          <label class="text-xs text-rose-400">Опиши проблему:</label>
          <textarea id="incidentComment" oninput="validateStep()" rows="2" class="w-full bg-slate-900 border border-rose-500/50 rounded-xl p-3 text-sm"></textarea>
        </div>
      </div>
      <button id="nextBtn" onclick="nextStep()" disabled class="w-full py-4 rounded-2xl font-bold text-slate-900 bg-amber-400 disabled:bg-slate-700 transition">Далее ➔</button>
    </div>

    <!-- ЭКРАН 2: АВТО-КАССА ИЗ CSV -->
    <div id="cashView" class="hidden bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
      <h2 class="text-xl font-bold text-amber-400">💰 Авто-закрытие смены</h2>
      
      <div class="bg-slate-900/50 p-4 rounded-xl border border-dashed border-amber-500/50 space-y-3">
        <p class="text-xs text-amber-300 uppercase">1. Загрузите файлы из кассы:</p>
        <label class="flex items-center gap-3 bg-slate-800 p-3 rounded-lg border border-slate-600 cursor-pointer">
          <span class="text-2xl">📄</span>
          <div class="flex-1">
            <p class="text-sm font-bold text-slate-200" id="transFileName">Транзакции.csv</p>
            <p class="text-xs text-slate-400">Считает нал, безнал и чеки</p>
          </div>
          <input type="file" accept=".csv" class="hidden" onchange="parseCSV(this, 'trans')">
        </label>
        <label class="flex items-center gap-3 bg-slate-800 p-3 rounded-lg border border-slate-600 cursor-pointer">
          <span class="text-2xl">📈</span>
          <div class="flex-1">
            <p class="text-sm font-bold text-slate-200" id="salesFileName">Продажи.csv</p>
            <p class="text-xs text-slate-400">Ищет Топ-3 хита дня</p>
          </div>
          <input type="file" accept=".csv" class="hidden" onchange="parseCSV(this, 'sales')">
        </label>
      </div>

      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-slate-400">💵 Наличные (₽):</label><input type="number" id="cashInput" class="w-full mt-1 bg-slate-900 p-3 rounded-xl font-bold text-emerald-400" readonly></div>
          <div><label class="text-xs text-slate-400">💳 Терминал (₽):</label><input type="number" id="cardInput" class="w-full mt-1 bg-slate-900 p-3 rounded-xl font-bold text-emerald-400" readonly></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-slate-400">🧾 Чеков:</label><input type="number" id="checksInput" class="w-full mt-1 bg-slate-900 p-3 rounded-xl font-bold" readonly></div>
          <div><label class="text-xs text-slate-400">🗑 Списания (₽):</label><input type="number" id="writeOffsInput" placeholder="0" class="w-full mt-1 bg-slate-900 p-3 border border-slate-700 rounded-xl font-bold"></div>
        </div>
      </div>
      <div class="bg-slate-900 p-3 rounded-xl flex justify-between text-sm shadow-inner">
        <div><p class="text-xs text-slate-400">Итого выручка:</p><p id="totalDisplay" class="text-xl font-bold text-amber-400">0 ₽</p></div>
        <div class="text-right"><p class="text-xs text-slate-400">Средний чек:</p><p id="avgDisplay" class="text-lg font-bold text-emerald-400">0 ₽</p></div>
      </div>
      <button id="submitCashBtn" onclick="submitCash()" class="w-full py-4 rounded-2xl font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300">✅ Отправить кассовый отчет</button>
    </div>

    <!-- ЭКРАН 3: УСПЕХ -->
    <div id="doneView" class="hidden text-center py-12 space-y-4">
      <div class="text-6xl">🎉</div>
      <h2 class="text-2xl font-bold text-emerald-400">Отправлено!</h2>
      <button onclick="location.reload()" class="px-6 py-3 bg-slate-800 rounded-xl text-sm">Вернуться на главную</button>
    </div>
  </main>

  <script>
    // ВАША РАБОЧАЯ ССЫЛКА НА GOOGLE APPS SCRIPT:
    const API_URL = "https://script.google.com/macros/s/AKfycbzCECsUCN3d2WOYvjkKZ56lgnYaqW1s1UhMs8ne6u_hzOpcHilgKgB7VaKeUNHwssdLzw/exec";

    const tg = window.Telegram?.WebApp;
    if (tg) tg.expand();
    const userName = tg?.initDataUnsafe?.user?.first_name || "Бариста";
    document.getElementById("userInfo").innerText = `📍 Кофейня №1 | 👤 ${userName}`;

    let allTasks = [], currentTasks = [], currentIndex = 0, answers = [];
    let currentPhotoBase64 = "", isCurrentIncident = false, topItemsData = "";

    window.onload = async () => {
      try {
        const res = await fetch(`${API_URL}?action=get_checklists`);
        const data = await res.json();
        allTasks = data.tasks || [];
      } catch (e) { allTasks = []; }
      selectBlock("Открытие");
    };

    function selectBlock(blockName) {
      document.getElementById("loader").classList.add("hidden");
      document.getElementById("doneView").classList.add("hidden");
      if (blockName === "КАССА") {
        document.getElementById("checklistView").classList.add("hidden");
        document.getElementById("progressBarContainer").classList.add("hidden");
        document.getElementById("cashView").classList.remove("hidden");
        return;
      }
      document.getElementById("cashView").classList.add("hidden");
      document.getElementById("progressBarContainer").classList.remove("hidden");
      currentTasks = allTasks.filter(t => t.block === blockName);
      currentIndex = 0; answers = [];
      if(currentTasks.length > 0) renderStep();
    }

    function renderStep() {
      document.getElementById("checklistView").classList.remove("hidden");
      const task = currentTasks[currentIndex];
      document.getElementById("stepCounter").innerText = `Шаг ${currentIndex + 1} из ${currentTasks.length}`;
      document.getElementById("progressBar").style.width = `${(currentIndex / currentTasks.length) * 100}%`;
      document.getElementById("taskTitle").innerText = task.title;
      document.getElementById("taskInstruction").innerText = task.instruction;
      document.getElementById("photoBlock").classList.toggle("hidden", !task.mediaRequired);
      
      currentPhotoBase64 = ""; document.getElementById("incidentComment").value = "";
      document.getElementById("photoPreview").classList.add("hidden");
      document.getElementById("photoPrompt").innerText = "Открыть камеру";
      setStepStatus(false);
      document.getElementById("nextBtn").innerText = (currentIndex === currentTasks.length - 1) ? "✅ Отправить" : "Далее ➔";
    }

    function setStepStatus(isInc) {
      isCurrentIncident = isInc;
      document.getElementById("incidentBox").classList.toggle("hidden", !isInc);
      document.getElementById("btnOk").className = !isInc ? "py-2.5 rounded-xl border border-emerald-500 bg-emerald-500/20 text-emerald-300" : "py-2.5 rounded-xl border border-slate-600 bg-slate-700/40 text-slate-300";
      document.getElementById("btnIncident").className = isInc ? "py-2.5 rounded-xl border border-rose-500 bg-rose-500/20 text-rose-300" : "py-2.5 rounded-xl border border-slate-600 bg-slate-700/40 text-slate-300";
      validateStep();
    }

    function handlePhoto(e) {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        const img = new Image();
        img.onload = function() {
          const cvs = document.createElement("canvas");
          const scale = img.width > 800 ? 800 / img.width : 1;
          cvs.width = Math.round(img.width * scale); cvs.height = Math.round(img.height * scale);
          cvs.getContext("2d").drawImage(img, 0, 0, cvs.width, cvs.height);
          currentPhotoBase64 = cvs.toDataURL("image/jpeg", 0.6);
          document.getElementById("photoPreview").src = currentPhotoBase64;
          document.getElementById("photoPreview").classList.remove("hidden");
          document.getElementById("photoPrompt").innerText = "Фото прикреплено";
          validateStep();
        }; img.src = evt.target.result;
      }; reader.readAsDataURL(file);
    }

    function validateStep() {
      const t = currentTasks[currentIndex];
      document.getElementById("nextBtn").disabled = !((!t.mediaRequired || currentPhotoBase64) && (!isCurrentIncident || document.getElementById("incidentComment").value.length > 2));
    }

    async function nextStep() {
      answers.push({ id: currentTasks[currentIndex].id, title: currentTasks[currentIndex].title, isIncident: isCurrentIncident, comment: document.getElementById("incidentComment").value, photo_base64: currentPhotoBase64, responsible: currentTasks[currentIndex].responsible });
      if (currentIndex < currentTasks.length - 1) { currentIndex++; renderStep(); } 
      else {
        document.getElementById("checklistView").classList.add("hidden"); document.getElementById("loader").classList.remove("hidden");
        fetch(API_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "submit_checklist", location: "Кофейня №1", userName: userName, block: document.getElementById("blockSelector").value, items: answers }) });
        document.getElementById("progressBar").style.width = "100%";
        document.getElementById("loader").classList.add("hidden"); document.getElementById("doneView").classList.remove("hidden");
      }
    }

    // --- ЛОГИКА CSV ---
    function parseCSV(input, type) {
      const file = input.files[0]; if (!file) return;
      if (type === 'trans') document.getElementById('transFileName').innerText = '✅ Транзакции.csv (Готово)';
      if (type === 'sales') document.getElementById('salesFileName').innerText = '✅ Продажи.csv (Готово)';

      const reader = new FileReader();
      reader.readAsText(file, 'windows-1251'); 
      reader.onload = function(e) {
        const rows = e.target.result.split('\n').map(r => r.split(';'));
        if (type === 'trans') {
          let cash = 0, card = 0, checks = 0;
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].length < 4) continue;
            let method = rows[i][2] || "", amt = parseFloat((rows[i][3] || "0").replace(',', '.'));
            if (method.includes("Наличный")) cash += amt; else if (method.includes("Мобильный")||method.includes("Карта")||method.includes("Безнал")) card += amt;
            if (amt > 0) checks++;
          }
          document.getElementById("cashInput").value = Math.round(cash);
          document.getElementById("cardInput").value = Math.round(card);
          document.getElementById("checksInput").value = checks;
          const total = cash + card;
          document.getElementById("totalDisplay").innerText = `${total} ₽`;
          document.getElementById("avgDisplay").innerText = `${checks > 0 ? Math.round(total/checks) : 0} ₽`;
        }
        if (type === 'sales') {
          let salesMap = {};
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].length < 8) continue;
            let item = (rows[i][0] || "").trim(), amt = parseFloat((rows[i][8] || "0").replace(',', '.'));
            if (item && amt > 0 && item !== "nan") salesMap[item] = (salesMap[item] || 0) + amt;
          }
          topItemsData = Object.entries(salesMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map((v,i)=>`${i+1}. ${v[0]} (${Math.round(v[1])} ₽)`).join('\n');
        }
      };
    }

    async function submitCash() {
      document.getElementById("submitCashBtn").disabled = true;
      document.getElementById("submitCashBtn").innerText = "Анализ и отправка...";
      fetch(API_URL, {
        method: "POST", mode: "no-cors",
        body: JSON.stringify({
          action: "submit_cash", location: "Кофейня №1", userName: userName,
          cash: document.getElementById("cashInput").value, card: document.getElementById("cardInput").value,
          checks: document.getElementById("checksInput").value, writeOffs: document.getElementById("writeOffsInput").value,
          topItems: topItemsData
        })
      });
      document.getElementById("cashView").classList.add("hidden"); document.getElementById("doneView").classList.remove("hidden");
    }
  </script>
</body>
</html>
