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

    // Detaylar butonu için toggle
    const detailsButton = document.getElementById('details-button');
    const featureImage = document.getElementById('feature-image');
    const featurePreview = document.getElementById('feature-preview');
    
    // create modal overlay element (hidden until used)
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    const modalImg = document.createElement('img');
    modal.appendChild(modalImg);
    document.body.appendChild(modal);

    function openModal() {
        modalImg.src = featureImage.src;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    detailsButton.addEventListener('click', function() {
        if (!featurePreview) return;
        const isHidden = window.getComputedStyle(featurePreview).display === 'none';
        featurePreview.style.display = isHidden ? 'flex' : 'none';
    });

    // open modal when the shown image is clicked
    if (featureImage) {
        featureImage.addEventListener('click', function() {
            // only open modal if preview is visible
            const isPreviewVisible = featurePreview && window.getComputedStyle(featurePreview).display !== 'none';
            if (isPreviewVisible) openModal();
        });
    }

    // close modal when clicking outside the image
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
    });

    // close on ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeModal();
    });
});