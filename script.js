// Файл: script.js

// 1. Настройки
// ВАЖНО: Ваш номер WhatsApp +77771789852 (без знака +)
const WHATSAPP_NUMBER = '77771789852'; 
const MENU = [
    { 
        id: 1, 
        name: "Ролл Жар. с курицей (8 шт.)", 
        price: 2130, // Цена в тенге
        img: "images/roll_chicken.jpg" // Файл должен быть в папке images
    },
    { 
        id: 2, 
        name: "Ролл Жар. Тобико (8 шт.)", 
        price: 2300, 
        img: "images/roll_tobiko.jpg"
    },
    { 
        id: 3, 
        name: "Ролл Фидалельфия (8 шт.)", 
        price: 3500, 
        img: "images/roll_philadelphia.jpg"
    },
    { 
        id: 4, 
        name: "Ролл Угорь (8 шт.)", 
        price: 2700, 
        img: "images/roll_eel.jpg"
    },
    { 
        id: 5, 
        name: "Сет 'Сумо-Сан' (80 шт.)", 
        price: 22000, 
        img: "images/set_sumosan.jpg"
    }
];

let cart = {}; // Объект для хранения {ID_БЛЮДА: Количество}

// 2. Отображение меню
function renderMenu() {
    const menuContainer = document.getElementById('menu-items');
    menuContainer.innerHTML = ''; // Очищаем

    MENU.forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.className = 'item-card';
        itemCard.innerHTML = `
            <img src="${item.img}" alt="${item.name}">
            <div class="item-info">
                <h3>${item.name}</h3>
                <p>Цена: ${item.price} тг</p>
                <button onclick="addToCart(${item.id})">Добавить в заказ</button>
                <span id="count-${item.id}" style="margin-left: 10px; font-weight: bold; color: #ff5722;"></span>
            </div>
        `;
        menuContainer.appendChild(itemCard);
    });
    updateCartDisplay();
}

// 3. Добавление в корзину
function addToCart(itemId) {
    cart[itemId] = (cart[itemId] || 0) + 1;
    updateCartDisplay();
}

// 4. Обновление отображения корзины
function updateCartDisplay() {
    const cartDisplay = document.getElementById('cart');
    const checkoutButton = document.getElementById('checkout-button');
    let total = 0;
    let cartItemsText = '';

    for (const itemId in cart) {
        if (cart[itemId] > 0) {
            const item = MENU.find(i => i.id == itemId);
            if (item) {
                const subtotal = item.price * cart[itemId];
                total += subtotal;
                // Отображаем блюда в корзине
                cartItemsText += `<li>${item.name} x ${cart[itemId]} = ${subtotal} тг</li>`;
                // Отображаем количество у самого блюда
                document.getElementById(`count-${itemId}`).textContent = `(${cart[itemId]})`;
            }
        } else {
             document.getElementById(`count-${itemId}`).textContent = '';
        }
    }
    
    // Проверка, пуста ли корзина
    const cartHasItems = total > 0;
    checkoutButton.disabled = !cartHasItems;

    if (cartHasItems) {
        cartDisplay.innerHTML = `<ul>${cartItemsText}</ul><p><strong>Общая сумма: ${total} тг</strong></p>`;
    } else {
        cartDisplay.innerHTML = 'Ваша корзина пуста.';
    }
}

// 5. Показать форму клиента
function showOrderForm() {
    document.getElementById('order-form-section').style.display = 'none';
    document.getElementById('customer-info').style.display = 'block';
}

// 6. Обработка отправки формы и создание ссылки WhatsApp
document.getElementById('order-form').addEventListener('submit', function(e) {
    e.preventDefault(); // Останавливаем обычную отправку формы

    // Получаем данные клиента
    const name = document.getElementById('customer-name').value;
    const address = document.getElementById('customer-address').value;
    const phone = document.getElementById('customer-phone').value;
    const notes = document.getElementById('customer-notes').value;

    // Формируем список заказа
    let orderDetails = '--- НОВЫЙ ЗАКАЗ НА ДОСТАВКУ (Праздник) ---\n\n';
    orderDetails += `Имя: ${name}\n`;
    orderDetails += `Телефон: ${phone}\n`;
    orderDetails += `Адрес: ${address}\n\n`;
    orderDetails += '--- Детали заказа ---\n';

    let total = 0;
    
    // Добавляем блюда из корзины
    for (const itemId in cart) {
        const count = cart[itemId];
        if (count > 0) {
            const item = MENU.find(i => i.id == itemId);
            if (item) {
                const subtotal = item.price * count;
                total += subtotal;
                orderDetails += `- ${item.name} (${item.price} тг) x ${count} = ${subtotal} тг\n`;
            }
        }
    }

    orderDetails += `\nИТОГОВАЯ СУММА: ${total} тг\n\n`;
    
    if (notes) {
        orderDetails += `КОММЕНТАРИИ: ${notes}\n\n`;
    }

    orderDetails += 'Ожидайте звонка оператора для подтверждения!';
    
    // --- Создание ссылки WhatsApp ---
    const encodedOrderDetails = encodeURIComponent(orderDetails); 
    
    // Формируем ссылку wa.me/[ваш_номер]?text=[текст_сообщения]
    const whatsappLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodedOrderDetails}`;

    // Открываем WhatsApp
    window.open(whatsappLink, '_blank');
    
    // Очищаем корзину и возвращаемся к началу формы для нового заказа
    cart = {};
    renderMenu();
    document.getElementById('customer-info').style.display = 'none';
    document.getElementById('order-form-section').style.display = 'block';
    document.getElementById('order-form').reset(); // Очищаем поля формы
});


// Запускаем отображение меню при загрузке страницы
document.addEventListener('DOMContentLoaded', renderMenu);