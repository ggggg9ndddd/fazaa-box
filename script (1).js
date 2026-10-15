// Global State
let bookingData = {
    toolName: '',
    toolPrice: '',
    studentName: '',
    universityId: '',
    phone: '',
    duration: '',
    pinCode: ''
};

// Navigation Helper
function goToStep(stepId) {
    document.querySelectorAll('.step-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(stepId).classList.add('active');
}

// Step 1 -> Step 2
function selectTool(name, price) {
    bookingData.toolName = name;
    bookingData.toolPrice = price;
    document.getElementById('selectedToolDisplay').value = `${name} (${price})`;
    goToStep('step-form');
}

// Step 2 -> Step 3
function handleFormSubmit(e) {
    e.preventDefault();
    bookingData.studentName = document.getElementById('studentName').value;
    bookingData.universityId = document.getElementById('universityId').value;
    bookingData.phone = document.getElementById('phoneNumber').value;
    bookingData.duration = document.getElementById('duration').value;
    goToStep('step-payment');
}

// Step 3 -> Step 4
function handlePaymentSubmit(e) {
    e.preventDefault();
    const randomPin = Math.floor(1000 + Math.random() * 9000);
    bookingData.pinCode = randomPin;
    document.getElementById('pinDisplay').innerText = randomPin;
    goToStep('step-success');
}

// WhatsApp Integration
function sendToWhatsApp() {
    const message = `*تفاصيل حجز صندوق فزعة* ⚡%0A%0A` +
        `*الأداة:* ${bookingData.toolName}%0A` +
        `*الاسم:* ${bookingData.studentName}%0A` +
        `*الرقم الجامعي:* ${bookingData.universityId}%0A` +
        `*المدة:* ${bookingData.duration}%0A` +
        `*رمز فتح الصندوق:* ${bookingData.pinCode}%0A%0A` +
        `شكراً لاستخدامك صندوق فزعة!`;

    const targetPhone = "968" + bookingData.phone.trim();
    const waUrl = `https://wa.me/${targetPhone}?text=${message}`;
    window.open(waUrl, '_blank');
}
