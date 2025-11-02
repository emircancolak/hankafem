document.addEventListener('DOMContentLoaded', function() {
    const categoryHeaders = document.querySelectorAll('.category h2');
    
    categoryHeaders.forEach(header => {
        header.addEventListener('click', function() {
            const categorySection = this.closest('.category');
            const menuItems = categorySection.querySelector('.menu-items');
            
            if (menuItems.style.display === 'block' || menuItems.style.display === '') {
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