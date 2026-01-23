// Test file for Phase 2 refactoring features
// Contains: magic numbers, nested conditionals

function processUser(user) {
    // Magic numbers
    if (user.age >= 18) {
        if (user.points >= 1000) {
            if (user.verified) {
                if (user.premium) {
                    // Deeply nested - should suggest early returns
                    const discount = user.points * 0.15;
                    const timeout = 86400000; // One day in ms
                    const maxRetries = 3;

                    return {
                        eligible: true,
                        discount: discount,
                        waitTime: timeout,
                        retries: maxRetries,
                        bonus: 500
                    };
                }
            }
        }
    }

    return { eligible: false };
}

function calculatePrice(items) {
    let total = 0;
    const taxRate = 0.0825; // Magic number
    const shippingThreshold = 50;

    for (let i = 0; i < items.length; i++) {
        total += items[i].price;
    }

    if (total >= 100) {
        total = total * 0.9; // 10% discount - magic number
    }

    if (total < shippingThreshold) {
        total += 9.99; // Shipping cost - magic number
    }

    return total * (1 + taxRate);
}

// HTTP status codes as magic numbers
function handleResponse(status) {
    if (status === 200) {
        return 'success';
    } else if (status === 404) {
        return 'not found';
    } else if (status === 500) {
        return 'server error';
    } else if (status === 401) {
        return 'unauthorized';
    }
    return 'unknown';
}
