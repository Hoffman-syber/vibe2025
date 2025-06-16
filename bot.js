// bot.js
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch'); // v2, используйте node-fetch@2
const TOKEN = '7111754190:AAHHUI0RFlopmk6knGdBdj5FbKOADseIK1Q'; // <-- ВСТАВЬТЕ СЮДА ТОКЕН ВАШЕГО БОТА
const API_URL = 'http://localhost:3000'; // Адрес вашего backend-сервера

const userStates = {};
const userCookies = {};

const bot = new TelegramBot(TOKEN, { polling: true });

// Старт работы с ботом
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { step: 'login' };
    bot.sendMessage(chatId, 'Пожалуйста, введите логин:');
});

// Обработка всех текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды
    if (text.startsWith('/')) return;

    const state = userStates[chatId];
    if (!state) {
        bot.sendMessage(chatId, 'Напишите /start для начала.');
        return;
    }

    // === Логин/Пароль ===
    if (state.step === 'login') {
        state.login = text;
        state.step = 'password';
        bot.sendMessage(chatId, 'Введите пароль:');
        return;
    }

    if (state.step === 'password') {
        state.password = text;
        // Пытаемся авторизоваться на сервере
        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login: state.login, password: state.password }),
            });

            const data = await response.json();
            const setCookie = response.headers.get('set-cookie');

            if (data.success && setCookie) {
                userCookies[chatId] = setCookie;
                state.step = 'authenticated';
                bot.sendMessage(
                    chatId,
                    'Авторизация успешна! Вот ваши задачи:\n\n' +
                    'Доступные команды:\n' +
                    '/add — добавить задачу\n' +
                    '/edit — редактировать задачу\n' +
                    '/delete — удалить задачу\n' +
                    '/tasks — показать задачи'
                );
                await sendTasks(chatId);
            } else {
                bot.sendMessage(chatId, 'Неверный логин или пароль. Попробуйте снова.\nВведите логин:');
                state.step = 'login';
            }
        } catch (e) {
            bot.sendMessage(chatId, 'Ошибка сервера. Попробуйте позже.');
            state.step = 'login';
        }
        return;
    }

    // === Ожидание ввода для добавления задачи ===
    if (state.step === 'add_item') {
        const newText = text.trim();
        if (!newText) {
            bot.sendMessage(chatId, 'Текст задачи не может быть пустым. Введите текст задачи:');
            return;
        }
        try {
            const response = await fetch(`${API_URL}/items`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': userCookies[chatId],
                },
                body: JSON.stringify({ text: newText }),
            });
            const data = await response.json();
            if (data.success) {
                bot.sendMessage(chatId, 'Задача добавлена!');
                state.step = 'authenticated';
                await sendTasks(chatId);
            } else {
                bot.sendMessage(chatId, 'Ошибка при добавлении задачи.');
            }
        } catch (e) {
            bot.sendMessage(chatId, 'Ошибка сервера при добавлении задачи.');
        }
        state.step = 'authenticated';
        return;
    }

    // === Ожидание выбора задачи для редактирования ===
    if (state.step === 'edit_choose') {
        const num = parseInt(text.trim(), 10);
        if (isNaN(num) || !state.tasks || num < 1 || num > state.tasks.length) {
            bot.sendMessage(chatId, 'Некорректный номер. Введите номер задачи для редактирования:');
            return;
        }
        state.editIndex = num - 1;
        state.step = 'edit_text';
        bot.sendMessage(
            chatId,
            `Введите новый текст для задачи:\n"${state.tasks[state.editIndex].text}"`
        );
        return;
    }

    // === Ожидание нового текста для редактирования ===
    if (state.step === 'edit_text') {
        const newText = text.trim();
        if (!newText) {
            bot.sendMessage(chatId, 'Текст задачи не может быть пустым. Введите новый текст:');
            return;
        }
        const task = state.tasks[state.editIndex];
        try {
            const response = await fetch(`${API_URL}/items/${task.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': userCookies[chatId],
                },
                body: JSON.stringify({ text: newText }),
            });
            const data = await response.json();
            if (data.success) {
                bot.sendMessage(chatId, 'Задача успешно изменена!');
                state.step = 'authenticated';
                await sendTasks(chatId);
            } else {
                bot.sendMessage(chatId, 'Ошибка при редактировании задачи.');
            }
        } catch (e) {
            bot.sendMessage(chatId, 'Ошибка сервера при редактировании задачи.');
        }
        state.step = 'authenticated';
        return;
    }

    // === Ожидание выбора задачи для удаления ===
    if (state.step === 'delete_choose') {
        const num = parseInt(text.trim(), 10);
        if (isNaN(num) || !state.tasks || num < 1 || num > state.tasks.length) {
            bot.sendMessage(chatId, 'Некорректный номер. Введите номер задачи для удаления:');
            return;
        }
        const task = state.tasks[num - 1];
        try {
            const response = await fetch(`${API_URL}/items/${task.id}`, {
                method: 'DELETE',
                headers: {
                    'Cookie': userCookies[chatId],
                },
            });
            const data = await response.json();
            if (data.success) {
                bot.sendMessage(chatId, 'Задача удалена!');
                state.step = 'authenticated';
                await sendTasks(chatId);
            } else {
                bot.sendMessage(chatId, 'Ошибка при удалении задачи.');
            }
        } catch (e) {
            bot.sendMessage(chatId, 'Ошибка сервера при удалении задачи.');
        }
        state.step = 'authenticated';
        return;
    }

    // === Уже авторизован, но не в процессе команды ===
    if (state.step === 'authenticated') {
        bot.sendMessage(
            chatId,
            'Доступные команды:\n' +
            '/add — добавить задачу\n' +
            '/edit — редактировать задачу\n' +
            '/delete — удалить задачу\n' +
            '/tasks — показать задачи'
        );
    }
});

// Команда: показать задачи
bot.onText(/\/tasks/, async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    if (!state || state.step !== 'authenticated') {
        bot.sendMessage(chatId, 'Сначала авторизуйтесь через /start');
        return;
    }
    await sendTasks(chatId);
});

// Команда: добавить задачу
bot.onText(/\/add/, (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    if (!state || state.step !== 'authenticated') {
        bot.sendMessage(chatId, 'Сначала авторизуйтесь через /start');
        return;
    }
    state.step = 'add_item';
    bot.sendMessage(chatId, 'Введите текст новой задачи:');
});

// Команда: редактировать задачу
bot.onText(/\/edit/, async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    if (!state || state.step !== 'authenticated') {
        bot.sendMessage(chatId, 'Сначала авторизуйтесь через /start');
        return;
    }
    // Получаем список задач
    const tasks = await getTasks(chatId);
    if (!tasks || tasks.length === 0) {
        bot.sendMessage(chatId, 'Список задач пуст.');
        return;
    }
    let message = 'Выберите номер задачи для редактирования:\n';
    tasks.forEach((item, i) => {
        message += `${i + 1}. ${item.text}\n`;
    });
    state.tasks = tasks;
    state.step = 'edit_choose';
    bot.sendMessage(chatId, message);
});

// Команда: удалить задачу
bot.onText(/\/delete/, async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    if (!state || state.step !== 'authenticated') {
        bot.sendMessage(chatId, 'Сначала авторизуйтесь через /start');
        return;
    }
    // Получаем список задач
    const tasks = await getTasks(chatId);
    if (!tasks || tasks.length === 0) {
        bot.sendMessage(chatId, 'Список задач пуст.');
        return;
    }
    let message = 'Выберите номер задачи для удаления:\n';
    tasks.forEach((item, i) => {
        message += `${i + 1}. ${item.text}\n`;
    });
    state.tasks = tasks;
    state.step = 'delete_choose';
    bot.sendMessage(chatId, message);
});

// Получение и отправка списка задач пользователю
async function sendTasks(chatId) {
    const tasks = await getTasks(chatId);
    if (!tasks) {
        bot.sendMessage(chatId, 'Ошибка при получении задач.');
        return;
    }
    if (tasks.length === 0) {
        bot.sendMessage(chatId, 'Список задач пуст.');
        return;
    }
    let msg = 'Ваши задачи:\n';
    tasks.forEach((item, i) => {
        msg += `${i + 1}. ${item.text}\n`;
    });
    bot.sendMessage(chatId, msg);
}

// Получить задачи с сервера
async function getTasks(chatId) {
    try {
        const response = await fetch(`${API_URL}/items`, {
            method: 'GET',
            headers: {
                'Cookie': userCookies[chatId],
            }
        });
        if (response.status === 401) {
            bot.sendMessage(chatId, 'Ваша сессия устарела. Пожалуйста, авторизуйтесь снова через /start.');
            userStates[chatId] = { step: 'login' };
            return null;
        }
        const items = await response.json();
        return Array.isArray(items) ? items : [];
    } catch (e) {
        return null;
    }
}
