import { Router } from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import { browsePizzas, createPizza, updatePizza, deletePizza } from '../controllers/pizzaController.js';

const router = Router();

// Customers can browse available pizzas
router.get('/', authenticate, verifyRole('customer'), browsePizzas);

// Vendor: create a pizza
router.post('/', authenticate, verifyRole('vendor'), createPizza);

// Vendor: update own pizza only
router.put('/:id', authenticate, verifyRole('vendor'), updatePizza);

// Vendor: delete own pizza only
router.delete('/:id', authenticate, verifyRole('vendor'), deletePizza);

export default router;
