const $ = (selector) => document.querySelector(selector);
let setup;

function labelFor(display) {
  const b = display.bounds;
  const kind = display.primary ? '主要螢幕' : '外接螢幕';
  const size = display.pixelSize ?? b;
  return `螢幕 ${display.index}｜${kind}｜${size.width}×${size.height} px｜原點 (${b.x}, ${b.y})`;
}

function fillSelect(select, displays, preferredId) {
  select.replaceChildren();
  for (const display of displays) {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = labelFor(display);
    select.append(option);
  }
  if (displays.some((display) => display.id === preferredId)) select.value = preferredId;
}

function render(data) {
  setup = data;
  const warning = $('#warning');
  if (data.reason) {
    warning.textContent = data.warning || ({
      unconfigured: '第一次使用，請先辨認並指定兩個螢幕。',
      'no-displays': 'Windows 尚未提供可用螢幕清單。請確認顯示器已連接，再重新啟動程式。',
      'display-missing': '先前設定的螢幕未連接，場次已暫停；請重新指定。',
      'display-changed': '偵測到螢幕位置、尺寸、縮放或方向改變；場次已暫停，請重新指定。',
      'same-display': '控制台與遊戲畫面必須使用不同螢幕。',
      'missing-game-display': '目前只有一個螢幕，先使用開發預覽。'
    })[data.reason] || '請確認螢幕配置。';
    warning.hidden = false;
  } else if (data.warning) {
    warning.textContent = data.warning;
    warning.hidden = false;
  } else warning.hidden = true;

  const screens = $('#screens'); screens.replaceChildren();
  for (const display of data.displays) {
    const card = document.createElement('article'); card.className = 'screen';
    const title = document.createElement('strong'); title.textContent = labelFor(display);
    const detail = document.createElement('small');
    detail.textContent = `識別碼 ${display.id} · 縮放 ${display.scaleFactor}× · 旋轉 ${display.rotation}°${display.internal ? ' · 內建' : ''}`;
    const identify = document.createElement('button'); identify.className = 'button';
    identify.textContent = '辨認這台螢幕';
    identify.addEventListener('click', async () => {
      $('#error').textContent = '';
      try { await window.desktop.identifyDisplay(display.id); }
      catch (error) { $('#error').textContent = error.message; }
    });
    card.append(title, detail, identify); screens.append(card);
  }

  const staff = $('#staff-display'), game = $('#game-display');
  const previous = data.settings ?? {};
  fillSelect(staff, data.displays, previous.staffDisplayId ?? data.displays.find((d) => d.primary)?.id);
  const defaultGame = data.displays.find((d) => d.id !== staff.value)?.id;
  fillSelect(game, data.displays, previous.gameDisplayId ?? defaultGame);
  staff.addEventListener('change', () => {
    if (staff.value === game.value) {
      const replacement = data.displays.find((display) => display.id !== staff.value);
      if (replacement) game.value = replacement.id;
    }
  });
  $('#save').disabled = data.displays.length < 2;
  $('#preview').hidden = data.displays.length !== 1;
}

$('#save').addEventListener('click', async () => {
  $('#error').textContent = '';
  try {
    await window.desktop.saveDisplaySettings({
      staffDisplayId: $('#staff-display').value,
      gameDisplayId: $('#game-display').value
    });
  } catch (error) { $('#error').textContent = error.message; }
});
$('#preview').addEventListener('click', async () => {
  $('#error').textContent = '';
  try { await window.desktop.continuePreview(); }
  catch (error) { $('#error').textContent = error.message; }
});

if (typeof window.desktop?.getDisplaySetup !== 'function') {
  $('#error').textContent = '桌面控制介面未載入，請關閉程式後重新開啟。';
  $('#save').disabled = true;
} else {
  window.desktop.getDisplaySetup().then(render).catch((error) => {
    $('#error').textContent = `無法讀取螢幕清單：${error.message}`;
    $('#save').disabled = true;
  });
}
