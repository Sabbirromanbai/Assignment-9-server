import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

// Collection used by all pizza operations
const PIZZAS = 'pizzas';

function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function isString(value, max = 500) {
  return typeof value === 'string' && value.trim().length <= max;
}

function validatePizzaInput(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const value = {};

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > 100) {
      return { error: 'Name is required and must be a string (max 100 characters)' };
    }
    value.name = body.name.trim();
  }

  if (!partial || body.price !== undefined) {
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
      return { error: 'Price is required and must be a positive number' };
    }
    value.price = body.price;
  }

  if (body.description !== undefined) {
    if (!isString(body.description, 1000)) {
      return { error: 'Description must be a string (max 1000 characters)' };
    }
    value.description = body.description.trim();
  }

  if (body.image !== undefined) {
    if (!isString(body.image, 500)) {
      return { error: 'Image must be a string (max 500 characters)' };
    }
    value.image = body.image.trim();
  }

  if (body.isAvailable !== undefined) {
    if (typeof body.isAvailable !== 'boolean') {
      return { error: 'isAvailable must be a boolean' };
    }
    value.isAvailable = body.isAvailable;
  } else if (!partial) {
    value.isAvailable = true;
  }

  return { value };
}

// --- controllers ---

// GET /api/pizzas — browse available pizzas
export async function browsePizzas(req, res) {
  try {
    const pizzas = await getDB()
      .collection(PIZZAS)
      .find({ isAvailable: true })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({ message: 'Available pizzas', data: pizzas });
  } catch (err) {
    console.error('browsePizzas error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// POST /api/pizzas — create a pizza (vendor only)
export async function createPizza(req, res) {
  try {
    const { error, value } = validatePizzaInput(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    // vendorId always comes from the authenticated user, never from the client
    const now = new Date();
    const pizza = {
      vendorId: req.user._id,
      ...value,
      createdAt: now,
      updatedAt: now,
    };

    const result = await getDB().collection(PIZZAS).insertOne(pizza);

    return res.status(201).json({
      message: 'Pizza created',
      data: { _id: result.insertedId, ...pizza },
    });
  } catch (err) {
    console.error('createPizza error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// PUT /api/pizzas/:id — update own pizza only (vendor only)
export async function updatePizza(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid pizza ID' });
    }

    const { error, value } = validatePizzaInput(req.body, true);
    if (error) {
      return res.status(400).json({ message: error });
    }
    if (Object.keys(value).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Ownership enforced in the query itself: pizza must match BOTH _id and vendorId
    const updated = await getDB()
      .collection(PIZZAS)
      .findOneAndUpdate(
        { _id: new ObjectId(id), vendorId: req.user._id },
        { $set: { ...value, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );

    if (!updated) {
      // Not found or owned by another vendor — same response either way
      return res.status(404).json({ message: 'Pizza not found' });
    }

    return res.status(200).json({ message: 'Pizza updated', data: updated });
  } catch (err) {
    console.error('updatePizza error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// DELETE /api/pizzas/:id — delete own pizza only (vendor only)
export async function deletePizza(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid pizza ID' });
    }

    // Ownership enforced in the query itself: pizza must match BOTH _id and vendorId
    const result = await getDB()
      .collection(PIZZAS)
      .deleteOne({ _id: new ObjectId(id), vendorId: req.user._id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Pizza not found' });
    }

    return res.status(200).json({ message: 'Pizza deleted' });
  } catch (err) {
    console.error('deletePizza error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
