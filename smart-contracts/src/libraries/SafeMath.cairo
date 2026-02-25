pub fn add(a: u256, b: u256) -> u256 {
    let result = a + b;
    assert(result >= a, 'addition overflow');
    result
}

pub fn sub(a: u256, b: u256) -> u256 {
    assert(b <= a, 'subtraction overflow');
    a - b
}

pub fn mul(a: u256, b: u256) -> u256 {
    if a == 0 {
        return 0;
    }
    let result = a * b;
    assert(result / a == b, 'multiplication overflow');
    result
}

pub fn div(a: u256, b: u256) -> u256 {
    assert(b > 0, 'division by zero');
    a / b
}

pub fn modulo(a: u256, b: u256) -> u256 {
    assert(b > 0, 'modulo by zero');
    a % b
}

pub fn pow(base: u256, exp: u256) -> u256 {
    if exp == 0 {
        return 1;
    }
    let mut result: u256 = 1;
    let mut base_copy = base;
    let mut exp_copy = exp;
    
    loop {
        if exp_copy % 2 == 1 {
            result = mul(result, base_copy);
        }
        exp_copy = exp_copy / 2;
        if exp_copy == 0 {
            break;
        }
        base_copy = mul(base_copy, base_copy);
    };
    result
}