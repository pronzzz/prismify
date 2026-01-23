// Messy JavaScript file for testing Prismify
// This file has poor variable names and inconsistent formatting

function calc(a, b, c) {
    let x = a + b
    let y = x * c
    let z = y / 2

    if (z > 10) {
        let r = z - 10
        return r
    } else {
        return z
    }
}

const f = (arr) => {
    let s = 0
    for (let i = 0; i < arr.length; i++) {
        s += arr[i]
    }
    return s
}

class D {
    constructor(n, v) {
        this.n = n
        this.v = v
    }

    g() {
        return this.v * 2
    }
}

// This function processes user data
function proc(u) {
    const n = u.name
    const a = u.age
    const e = u.email

    console.log('Processing user:', n)

    if (a < 18) {
        return { status: 'minor', n: n }
    }

    const r = {
        name: n,
        age: a,
        email: e,
        isAdult: true
    }

    return r
}

module.exports = { calc, f, D, proc }
