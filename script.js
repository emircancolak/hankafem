document.addEventListener('DOMContentLoaded', function() {
    const categoryHeaders = document.querySelectorAll('.category h2');
    
    categoryHeaders.forEach(header => {
        header.addEventListener('click', function() {
            const categorySection = this.closest('.category');
            const menuItems = categorySection.querySelector('.menu-items');
            
            // Tüm diğer açık menüleri kapat
            categoryHeaders.forEach(otherHeader => {
                if (otherHeader !== header) {
                    const otherSection = otherHeader.closest('.category');
                    const otherItems = otherSection.querySelector('.menu-items');
                    otherItems.style.display = 'none';
                    otherHeader.classList.remove('active');
                }
            });
            
            // Tıklanan menüyü aç/kapat
            if (menuItems.style.display === 'block') {
                menuItems.style.display = 'none';
                header.classList.remove('active');
            } else {
                menuItems.style.display = 'block';
                header.classList.add('active');
            }
        });
        
        // Başlangıçta menü öğelerini gizle
        const menuItems = header.closest('.category').querySelector('.menu-items');
        menuItems.style.display = 'none';
    });
});