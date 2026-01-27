use core::integer::BoundedInt;

#[derive(Copy, Drop)]
struct SafeMath {}

impl SafeMathImpl of SafeMathTrait {
    fn add(a: u256, b: u256) -> u256 {
        let result = a + b;
        assert(result >= a, 'SafeMath: addition overflow');
        result
    }

    fn sub(a: u256, b: u256) -> u256 {
        assert(b <= a, 'SafeMath: subtraction overflow');
        a - b
    }

    fn mul(a: u256, b: u256) -> u256 {
        if a == 0 {
            return 0;
        }
        let result = a * b;
        assert(result / a == b, 'SafeMath: multiplication overflow');
        result
    }

    fn div(a: u256, b: u256) -> u256 {
        assert(b > 0, 'SafeMath: division by zero');
        a / b
    }

    fn mod(a: u256, b: u256) -> u256 {
        assert(b > 0, 'SafeMath: modulo by zero');
        a % b
    }

    fn pow(base: u256, exp: u256) -> u256 {
        if exp == 0 {
            return 1;
        }
        let mut result = 1;
        let mut base_copy = base;
        let mut exp_copy = exp;
        
        loop {
            if exp_copy % 2 == 1 {
                result = SafeMathImpl::mul(result, base_copy);
            }
            exp_copy = exp_copy / 2;
            if exp_copy == 0 {
                break;
            }
            base_copy = SafeMathImpl::mul(base_copy, base_copy);
        };
        result
    }
}

trait SafeMathTrait {
    fn add(a: u256, b: u256) -> u256;
    fn sub(a: u256, b: u256) -> u256;
    fn mul(a: u256, b: u256) -> u256;
    fn div(a: u256, b: u256) -> u256;
    fn mod(a: u256, b: u256) -> u256;
    fn pow(base: u256, exp: u256) -> u256;
}