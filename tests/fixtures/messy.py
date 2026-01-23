# Messy Python file for testing Prismify
# This file has poor variable names and inconsistent formatting

def calc(a,b,c):
    x = a + b
    y=x*c
    z = y / 2
    
    if z>10:
        r = z - 10
        return r
    else:
        return z

def f(arr):
    s = 0
    for i in range(len(arr)):
        s += arr[i]
    return s

class D:
    def __init__(self, n, v):
        self.n = n
        self.v = v
    
    def g(self):
        return self.v * 2

def proc(u):
    n = u['name']
    a = u['age']
    e = u['email']
    
    print('Processing user:', n)
    
    if a < 18:
        return {'status': 'minor', 'n': n}
    
    r = {
        'name': n,
        'age': a,
        'email': e,
        'isAdult': True
    }
    
    return r
