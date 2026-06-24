Fixtures inventados para validar parsers bancarios.

Estos archivos no contienen datos reales. Imitan estructuras comunes de cartolas chilenas para fijar contratos del parser:

- deteccion por nombre de archivo, encabezado y cuerpo;
- variantes Santander, Banco Edwards/Banco de Chile e Itau;
- cartolas de tarjeta por columna de cuotas y texto "Pagar hasta";
- caso ambiguo de cuenta bancaria con columna "Cuotas".

Cuando se agreguen cartolas reales anonimizadas, mantener montos, fechas y descripciones ficticias, pero conservar el orden y nombre de columnas del banco.
