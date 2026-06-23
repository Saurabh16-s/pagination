require('dotenv').config();
const express=require('express');
const cors=require('cors');
const app=express();

app.use(cors());
app.use(express.json());

app.use('/products',require('./routes/products'));
app.get('/health',(_req,res)=>res.json({status:'ok'}));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`Server on port ${PORT}`));