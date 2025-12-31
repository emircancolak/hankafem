document.addEventListener('DOMContentLoaded', function() {
    // If the main menu doesn't already have the "Yılbaşı Extra" category,
    // create it so it appears like the other categories in the main menu.
    const menuContainer = document.querySelector('.menu-container');
    if (menuContainer && !document.querySelector('.category.yilbasi-extra')) {
        const extraCat = document.createElement('section');
        extraCat.className = 'category yilbasi-extra';

        const h2 = document.createElement('h2');
        h2.textContent = 'Yılbaşı Extra';
        extraCat.appendChild(h2);

        const menuItems = document.createElement('div');
        menuItems.className = 'menu-items';

        const items = [
            { name: 'Patlamış Mısır', price: '60 TL' },
            { name: 'Sıcak Çikolata', price: '100 TL' },
            { name: '4 Kişilik Meyve Tabağı', price: '200 TL' },
            { name: '2 Kişilik Meyve Tabağı', price: '150 TL' },
            { name: 'Çerez', price: '100 TL' }
        ];

        items.forEach(obj => {
            const item = document.createElement('div');
            item.className = 'menu-item';

            const h3 = document.createElement('h3');
            h3.textContent = obj.name;
            h3.style.margin = '0';
            h3.style.color = '#fff';

            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            priceSpan.textContent = obj.price;

            item.appendChild(h3);
            item.appendChild(priceSpan);
            menuItems.appendChild(item);
        });

        extraCat.appendChild(menuItems);
        // Insert the new category at the top of the menu container
        menuContainer.insertBefore(extraCat, menuContainer.firstChild);
    }

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
    // Başlangıçta detay önizlemesini gizle (buton kapalı)
    if (featurePreview) {
        featurePreview.style.display = 'none';
    }
    if (detailsButton) {
        detailsButton.classList.remove('active');
    }
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

    if (detailsButton) {
        detailsButton.addEventListener('click', function() {
            if (!featurePreview) return;
            const isHidden = window.getComputedStyle(featurePreview).display === 'none';
            featurePreview.style.display = isHidden ? 'flex' : 'none';

            // Create extra menu to the right of the image if it doesn't exist
            if (isHidden) {
                // ensure the feature image has a wrapper with overlay text
                if (featureImage) {
                    let wrapper = featureImage.closest('.feature-image-wrapper');
                    if (!wrapper) {
                        wrapper = document.createElement('div');
                        wrapper.className = 'feature-image-wrapper';
                        // move featureImage into wrapper
                        featureImage.parentNode.insertBefore(wrapper, featureImage);
                        wrapper.appendChild(featureImage);
                    }

                    // create overlay text if not present
                    let overlay = wrapper.querySelector('.feature-image-overlay');
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.className = 'feature-image-overlay';
                        overlay.textContent = 'Fotoğrafı büyültmek için tıklayınız';
                        wrapper.appendChild(overlay);
                    } else {
                        overlay.style.display = '';
                    }
                }

                let extraMenu = featurePreview.querySelector('.extra-menu');
                if (!extraMenu) {
                    extraMenu = document.createElement('div');
                    extraMenu.className = 'extra-menu';

                    const title = document.createElement('h3');
                    title.textContent = 'Yılbaşı ekstra menü';
                    title.style.color = 'var(--gold)';
                    title.style.margin = '0 0 6px 0';
                    title.style.letterSpacing = '1px';
                    title.style.textTransform = 'uppercase';
                    extraMenu.appendChild(title);

                    const items = [
                        { name: 'Patlamış Mısır', price: '60 TL' },
                        { name: 'Sıcak Çikolata', price: '100 TL' },
                        { name: '4 Kişilik Meyve Tabağı', price: '200 TL' },
                        { name: '2 Kişilik Meyve Tabağı', price: '150 TL' },
                        { name: 'Çerez', price: '100 TL' }
                    ];

                    items.forEach(obj => {
                        const item = document.createElement('div');
                        item.className = 'menu-item';

                        const h3 = document.createElement('h3');
                        h3.textContent = obj.name;
                        h3.style.margin = '0';
                        h3.style.color = '#fff';
                        item.appendChild(h3);

                        const priceSpan = document.createElement('span');
                        priceSpan.className = 'price';
                        priceSpan.textContent = obj.price;
                        item.appendChild(priceSpan);
                        extraMenu.appendChild(item);
                    });

                    featurePreview.appendChild(extraMenu);
                }
                detailsButton.classList.add('active');
            } else {
                // hide overlay when preview is closed (if exists)
                if (featureImage) {
                    const wrapper = featureImage.closest('.feature-image-wrapper');
                    const overlay = wrapper && wrapper.querySelector('.feature-image-overlay');
                    if (overlay) overlay.style.display = 'none';
                }
                detailsButton.classList.remove('active');
            }
        });
    }

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

    // close modal when clicking the enlarged image (single-click toggle)
    modalImg.addEventListener('click', function(e) {
        e.stopPropagation();
        if (modal.classList.contains('active')) closeModal();
    });

    // close on ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeModal();
    });
});