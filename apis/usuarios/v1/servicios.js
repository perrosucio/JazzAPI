/**
 * This file is part of JazzAPI
 *
 * JazzAPI - RESTful APIs set developed in Node.js to serve and manage application contents.
 * Copyright (C) 2019 by Guillermo Harosteguy <harosteguy@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

let conf = require('../../apis-comun/config'),
	BaseDatos = require('../../apis-comun/base-datos'),
	db = new BaseDatos( conf.dbHost, conf.dbUser, conf.dbPass, 'cms_usuarios' ),
	crypto = require('crypto'),
	fs = require('fs'),
	respuestas = require('../../apis-comun/respuestas'),
	modError = require('../../apis-comun/error'),
	nodemailer = require('nodemailer'),
	sanitizeHtml = require('sanitize-html');


module.exports = class Usuario {

	constructor( req, res ) {
		this.req = req;
		this.res = res;
		// Expresión regular de Chromium
		this.emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
		this.msj = require('./idiomas/' + req.idioma );
		this.mailHtmlCabeza = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
		<html xmlns="http://www.w3.org/1999/xhtml">
		<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /><title>Info</title></head>
		<body style="margin: 0; padding: 0;">
		<table border="0" cellpadding="1" cellspacing="0" width="100%"><tr><td>
		<table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse;">
		<tr><td><img src="${conf.imgMailHtmlTop}" alt="${conf.marca}" width="600" style="display: block;" /></td></tr>
		<tr><td bgcolor="#ffffff" style="padding: 40px 30px 40px 30px; font-size: 15px;">`;
		this.mailHtmlPie = `</td></tr><tr><td><img src="${conf.imgMailHtmlBottom}" alt="${conf.marca}" width="600" style="display: block;" /></td></tr></table></td></tr></table></body></html>`;
	}

	// Recibe en Authorization email y contraseña
	// Busca usuario, genera token nuevo, lo guarda y lo devuelve al cliente junto con nombre y apellido
	token() {
		if ( !this.req.headers.authorization ) {
			modError.responderError( 403, this.msj.usrNoAutori, this.res );
			return;
		}
		// Obtiene credenciales del header
		let encoded = this.req.headers.authorization.split(' ')[1],
			decoded = new Buffer( encoded, 'base64').toString('utf8'),
			aAux = decoded.split(':'),
			email = aAux[0],
			clave = aAux[1];
		// Verifica formato de email y existencia de contraseña.
		if ( !this.emailRegex.test( email ) || !clave ) {
			modError.responderError( 403, this.msj.usrNoAutori, this.res );
			return;
		}
		clave = crypto.createHash('md5').update( clave ).digest('hex');		// Clave encriptada para usar con base de datos
		let resul;
		db.consulta("select id, clave, nombre, apellido, esAdmin from usuarios where email = ? limit 1", [email] )
		.then( resultado => {
			resul = resultado;
			// Verifica existencia del uid y coincidencia con clave
			if ( resul.length == 0 || resul[0].clave !== clave ) {
				throw new modError.ErrorEstado(this.msj.usrNoAutori, 403 );
			}
			return this.crearToken( resul[0].id );
		}).then( token => {
			let cuerpoResp = {
				id: resul[0].id,
				token: token,
				nombre: resul[0].nombre,
				apellido: resul[0].apellido,
				esAdmin: resul[0].esAdmin
			};
			respuestas.responder( 200, cuerpoResp, this.req.headers['accept-encoding'], this.res );
		}).catch( error => {
			modError.manejarError( error, this.msj.usrNoAutori, this.res )
		});
	}

	// Verifica ID y token de usuario
	autorizacion() {
		this.usrOk().then( usr => {
			respuestas.responder( 200, usr, this.req.headers['accept-encoding'], this.res );
		}).catch( error => {
			modError.manejarError( error, this.msj.usrNoAutori, this.res )
		});
	}

	// Devuelve datos del usuario ID/token
	// El Admin puede obtener datos de un usuario pasando su email por URL
	obtener() {
		let cred;
		if ( !( cred = this.credenciales( this.req ) ) ) {
			modError.responderError( 403, this.msj.usrNoAutori, this.res );
			return;
		}
		// Recupera datos del usuario en credenciales
		db.consulta("select id, nombre, apellido, email, token, esAdmin from usuarios where id = ? limit 1", [cred.uid] )
		.then( resul => {
			if ( resul.length == 0 || resul[0].token !== cred.token ) {		// Verifica existencia del uid y coincidencia con el token
				throw new modError.ErrorEstado( this.msj.usrNoAutori, 403 );
			}
			let url = require('url'),
				email = url.parse( this.req.url, true ).query.email;			// Extrae email de la URL
			if ( email && resul[0].esAdmin === 1 ) {					// Recupera datos del usuario según email si lo pide el admin
				return db.consulta("select id, nombre, apellido, email from usuarios where email = ? limit 1", [email] );
			} else {
				let usr = {
					id: resul[0].id,
					nombre: resul[0].nombre,
					apellido: resul[0].apellido,
					email: resul[0].email
				};
				respuestas.responder( 200, usr, this.req.headers['accept-encoding'], this.res );				// Responde datos del usuario en credenciales
				return [];
			}
		}).then( resul => {
			if ( resul.length == 0 ) {
				throw new modError.ErrorEstado( this.msj.usrNoExiste, 404 );
			}
			let usr = {
				id: resul[0].id,
				nombre: resul[0].nombre,
				apellido: resul[0].apellido,
				email: resul[0].email
			};
			respuestas.responder( 200, usr, this.req.headers['accept-encoding'], this.res );				// Responde datos del usuario del email
		}).catch( error => {
			modError.manejarError( error, this.msj.errRecupeDatos, this.res )
		});
	}

	preRegistro() {
		let entrada;
		try { entrada = JSON.parse( this.req.cuerpo ) }
		catch ( error ) { 
			modError.responderError( 400, this.msj.cuerpoNoJson, this.res );
			return;
		}
		// Sanea y verifica
		let ahora, token, usr;
		this.verificarDatos( entrada ).then( usuario => {
			usr = usuario;
			// Limpia pre-registros viejos
			ahora = Math.floor( Date.now() / 1000 );
			let haceTresDias = ahora - ( 24 * 60 * 60 * 3 );
			db.consulta(`delete from pre_registro where tiempo < ${haceTresDias}`)
			.catch( error => { modError.logError('Error limpiando tabla pre_registro.') } );
			// Guarda pre-registro
			token = crypto.randomBytes(16).toString('hex');								// Genera token de registro
			let clave = crypto.createHash('md5').update( usr.clave1 ).digest('hex');	// Encripta clave
			let params = [ token, usr.email, clave, usr.nombre, usr.apellido, ahora];
			let consulta = `insert into pre_registro (token, email, clave, nombre, apellido, tiempo) values (?,?,?,?,?,?)`;
			return db.consulta( consulta, params );
		}).then( resul => {
			if ( resul.affectedRows == 0 ) throw new modError.ErrorEstado( this.msj.errGuardandoDatos, 500 );
			// Envía correo
			// Crea objeto transporte reusable usando SMTP transport por defecto
			/*
			let transporte = nodemailer.createTransport({
				host: 'smtp.ethereal.email',
				port: 587,
				secure: false, // true for 465, false for other ports
				auth: {
					user: 'ruj2aqaczpqva5du@ethereal.email',
					pass: 'Ch6BuHGN256Al8PNNq'
				}
			});
			*/
			let transporte = nodemailer.createTransport({
				service: 'gmail',
				port: 443,
				options: {
					debug: true,
				},
				auth: {
					user: conf.gmailEmisor,
					pass: conf.gmailPass
				}
			});
			// Datos del correo
			let correo = {
				from: `"${conf.marca}" <${conf.gmailEmisor}>`,
				to: usr.email,
				subject: `${conf.marca} - ${this.msj.registro}`
			};
			correo.text = `${usr.nombre} ${usr.apellido},\n${this.msj.mailPreRegistro}\n\n${conf.urlBase}/registro/confirmacion/${token}`;
			correo.html = `${this.mailHtmlCabeza}${usr.nombre} ${usr.apellido},<br>${this.msj.mailPreRegistro}<br><br>
			<a href="${conf.urlBase}/registro/confirmacion/${token}">${conf.urlBase}/registro/confirmacion/${token}</a>${this.mailHtmlPie}`;
			// Envía correo con el objeto transporte
			return transporte.sendMail( correo );
		}).then( info => {
			respuestas.responder( 200, { nombre: usr.nombre, apellido: usr.apellido, email: usr.email }, this.req.headers['accept-encoding'], this.res );
			// Vista previa disponible cuando se envía a travéz de una cuenta Ethereal
			//console.log('URL de vista previa: %s', nodemailer.getTestMessageUrl(info));
		}).catch( error => {
			modError.manejarError( error, this.msj.errRegistrando, this.res )
		});
	}

	registro() {
		let entrada;
		try { entrada = JSON.parse( this.req.cuerpo ) }
		catch ( error ) { 
			modError.responderError( 400, this.msj.cuerpoNoJson, this.res );
			return;
		}
		// Verifica token de registro
		let regExp = /[0-9A-Fa-f]{32}/g;
		if ( !regExp.test( entrada.token ) ) {
			modError.responderError( 400, this.msj.tokenNoValido, this.res );
			return;
		}
		// Obtiene datos de pre-registro
		let usr;
		db.consulta('select email, clave, nombre, apellido from pre_registro where token = ? limit 1', [entrada.token] )
		.then( resul => {
			if ( resul.length == 0 ) throw new Error( this.msj.tokenNoExiste );
			usr = resul[0];
			usr.token = crypto.randomBytes(16).toString('hex');				// Genera token de usuario
			let fechaAlta = ( new Date() ).toISOString().slice( 0, 10 );	// Fecha formato mysql date
			// Agrega datos de pre-registro a tabla de usuarios junto con token de usuario
			let consulta = 'insert into usuarios (email, clave, token, nombre, apellido, alta) values (?,?,?,?,?,?)';
			let params = [usr.email, usr.clave, usr.token, usr.nombre, usr.apellido, fechaAlta];
			return db.consulta( consulta, params );
		})
		.then( resul => {
			if ( resul.insertId == 0 ) throw new Error( this.msj.errRegistrando );
			// Elimina pre-registro
			db.consulta("delete from pre_registro where token = ? limit 1", [entrada.token] )
			.catch( error => { modError.logError('Error eliminando pre-registro.') } );
			// Devuelve datos de usuario
			let respuesta = { uid: resul.insertId, token: usr.token, nombre: usr.nombre, apellido: usr.apellido };
			respuestas.responder( 200, respuesta, this.req.headers['accept-encoding'], this.res );
		}).catch( error => {
			modError.manejarError( error, this.msj.errRegistrando, this.res )
		});
	}

	actualizar() {
		respuestas.responder( 200, { abc: 'def' }, this.req.headers['accept-encoding'], this.res );
	}

	imagen() {
		let archivo, nombreArchivo;
		this.usrOk().then( usr => {
			let cuerpo;
			try { cuerpo = JSON.parse( this.req.cuerpo ) }											// Obtiene info del archivo
			catch ( error ) { throw new modError.ErrorEstado( this.msj.cuerpoNoJson, 400 ) }
			archivo = cuerpo.archivo;
			// Verifica tipo de archivo
			// NOTA: La cadena en archivo.tipo no garantiza que el contenido del archivo sea jpg.
			if ( archivo.tipo !== 'image/jpeg' ) {
				throw new modError.ErrorEstado( this.msj.noEsJpg, 400 );
			}
			nombreArchivo = ('000000' + usr.id ).slice( -6 ) + '.jpg';
			let archivoNuevo = conf.dirBaseImagen + 'usuarios/' + nombreArchivo;
			return this.imagenRedim('tmp/' + archivo.nombreTmp, archivoNuevo, 260, 260 );
		}).then( () => {
			respuestas.responder( 200, { url: conf.urlBaseImagen + 'usuarios/' + nombreArchivo }, this.req.headers['accept-encoding'], this.res );
			// Elimina archivo temporal
			fs.unlink('tmp/' + archivo.nombreTmp, ( error ) => {
				if ( error ) modError.logError( JSON.stringify( error ) );
			});
		}).catch( error => {
			modError.manejarError( error, this.msj.usrNoAutori, this.res )
		});
	}

	emailClave() {
		let entrada;
		try { entrada = JSON.parse( this.req.cuerpo ) }
		catch ( error ) { 
			modError.responderError( 400, this.msj.cuerpoNoJson, this.res );
			return;
		}
		// Verifica correo
		if ( !this.emailRegex.test( entrada.email ) ) {
			modError.responderError( 400, this.msj.errCorreo, this.res );
			return;
		}
		// Limpia registros viejos
		let ahora = Math.floor( Date.now() / 1000 );
		let haceTresDias = ahora - ( 24 * 60 * 60 * 3 );
		db.consulta(`delete from clave_nueva where tiempo < ${haceTresDias}`)
		.catch( error => { modError.logError('Error limpiando tabla clave_nueva.') } );
		// Obtiene datos de usuario
		let token, usr;
		db.consulta("select email, nombre, apellido from usuarios where email = ? limit 1", [entrada.email] )
		.then( resul => {
			if ( resul.length == 0 ) throw new modError.ErrorEstado( this.msj.usrNoExiste, 404 );
			usr = resul[0];
			token = crypto.randomBytes(16).toString('hex');				// Genera token de recuperación
			let ahora = Math.floor( Date.now() / 1000 );
			// Guarda email y token
			return db.consulta("insert into clave_nueva (email, token, tiempo) values (?,?,?)", [entrada.email, token, ahora] );
		}).then( resul => {
			if ( resul.affectedRows == 0 ) throw new modError.ErrorEstado( this.msj.errGuardandoDatos, 500 );
			// Envía correo
			// Crea objeto transporte reusable usando SMTP transport por defecto
			/*
			let transporte = nodemailer.createTransport({
				host: 'smtp.ethereal.email',
				port: 587,
				secure: false, // true for 465, false for other ports
				auth: {
					user: 'ruj2aqacqtava5du@ethereal.email',
					pass: 'Ch6BuXBN256Ak8PNNq'
				}
			});
			*/
			let transporte = nodemailer.createTransport({
				service: 'gmail',
				port: 443,
				options: {
					debug: true,
				},
				auth: {
					user: conf.gmailEmisor,
					pass: conf.gmailPass
				}
			});
			// Datos del correo
			let correo = {
				from: `"${conf.marca}" <${conf.gmailEmisor}>`,
				to: usr.email,
				subject: `${conf.marca} - ${this.msj.recuperarPass}`
			};
			correo.text = `${usr.nombre} ${usr.apellido},\n${this.msj.paraNuevaClaveEntraEn}\n\n${conf.urlBase}/clave/confirmacion/${token}`;
			correo.html = `${this.mailHtmlCabeza}${usr.nombre} ${usr.apellido},<br>${this.msj.paraNuevaClaveEntraEn}<br><br>
			<a href="${conf.urlBase}/clave/confirmacion/${token}">${conf.urlBase}/clave/confirmacion/${token}</a>${this.mailHtmlPie}`;
			// Envía correo con el objeto transporte
			return transporte.sendMail( correo );
		}).then( info => {
			respuestas.responder( 200, { mensaje: this.msj.teEnviamosInstrucciones}, this.req.headers['accept-encoding'], this.res );
			// Vista previa disponible cuando se envía a travéz de una cuenta Ethereal
			//console.log('URL de vista previa: %s', nodemailer.getTestMessageUrl(info));
		}).catch( error => {
			modError.manejarError( error, this.msj.errorDesconocido, this.res )
		});
	}

	nuevaClave() {
		let entrada;
		try { entrada = JSON.parse( this.req.cuerpo ) }
		catch ( error ) { 
			modError.responderError( 400, this.msj.cuerpoNoJson, this.res );
			return;
		}
		// Verifica token y claves
		let regExp = /[0-9A-Fa-f]{32}/g;
		if ( !regExp.test( entrada.token ) ) {
			modError.responderError( 400, this.msj.tokenNoValido, this.res );
			return;
		}
		entrada.clave1 = entrada.clave1 || '';
		entrada.clave2 = entrada.clave2 || '';
		if ( entrada.clave1 === '' || entrada.clave2 === '' || entrada.clave1 !== entrada.clave2 ) {
			modError.responderError( 400, this.msj.clavesNoIgualesOVacias );
			return;
		}
		// Busca email del usuario con el token
		let email, usr;
		db.consulta("select email from clave_nueva where token = ? limit 1", [entrada.token] )
		.then( resul => {
			if ( resul.length == 0 ) throw new Error( this.msj.tokenNoExiste );
			email = resul[0].email;
			let clave = crypto.createHash('md5').update( entrada.clave1 ).digest('hex');	// Encripta clave
			// Actualiza clave
			return db.consulta("update usuarios set clave = ? where email = ? limit 1", [clave, email] );
		}).then( resul => {
			if ( resul.affectedRows == 0 ) throw new Error( this.msj.errActualiClaves );
			// Elimina el registro de recuperación de clave
			db.consulta("delete from clave_nueva where token = ? limit 1", [entrada.token] )
			.catch( error => { modError.logError('Error eliminando registro de recuperación de contraseña.') } );
			// Recupera datos para respuesta
			return db.consulta("select id, nombre, apellido, esAdmin from usuarios where email = ? limit 1", [email] );
		}).then( resul => {
			if ( resul.length == 0 ) throw new Error( this.msj.errRecupeDatos );
			usr = resul[0];
			return this.crearToken( usr.id );
		}).then( token => {
			usr.token = token;
			respuestas.responder( 200, usr, this.req.headers['accept-encoding'], this.res );
		}).catch( error => {
			modError.manejarError( error, this.msj.errorDesconocido, this.res )
		});
	}

	eliminar() {
		respuestas.responder( 200, { abc: 'def' }, this.req.headers['accept-encoding'], this.res );
	}

	//------

	credenciales() {
		// Obtiene credenciales del header Authorization
		if ( this.req.headers.authorization ) {
			let encoded = this.req.headers.authorization.split(' ')[1],
				decoded = new Buffer( encoded, 'base64').toString('utf8'),
				aAux = decoded.split(':'),
				usrId = parseInt( aAux[0], 10 );
			if ( usrId > 0  && ( /[0-9a-f]{32}/g ).test( aAux[1] ) ) {		// Valída credenciales
				return { uid: aAux[0], token: aAux[1] };
			}
		}
		return false;
	}

	usrOk() {
		return new Promise( ( resuelve, rechaza ) => {
			let cred;
			if ( !( cred = this.credenciales( this.req ) ) ) {
				rechaza( new modError.ErrorEstado( this.msj.usrNoAutori, 403 ) );
				return;
			}
			db.consulta("select id, token, nombre, apellido, esAdmin from usuarios where id = ? limit 1", [cred.uid] )
			.then( resul => {
				// Verifica existencia del uid y coincidencia con el token
				if ( resul.length == 0 || resul[0].token !== cred.token ) {
					rechaza( new modError.ErrorEstado( this.msj.usrNoAutori, 403 ) );
					return;
				}
				resuelve( { id: resul[0].id, nombre: resul[0].nombre, apellido: resul[0].apellido, esAdmin: resul[0].esAdmin } );
				return;
			}).catch( error => {
				rechaza( new modError.ErrorEstado( this.msj.usrNoAutori, 403 ) );
				return;
			});
		});
	}

	sanear( datos ) {
		return new Promise( resuelve => {
			let oFiltroTexto = {	// sanitizeHtml
				allowedTags: [],
				allowedAttributes: [],
			};
			datos.nombre = datos.nombre ? sanitizeHtml( datos.nombre, oFiltroTexto ) : '';
			datos.apellido = datos.apellido ? sanitizeHtml( datos.apellido, oFiltroTexto ) : '';
			datos.email = datos.email ? sanitizeHtml( datos.email, oFiltroTexto ) : '';
			datos.clave1 = datos.clave1 || '';
			datos.clave2 = datos.clave2 || '';
			resuelve( datos );
			return;
		});
	};

	verificarDatos( datos ) {
		return new Promise( ( resuelve, rechaza ) => {
			this.sanear( datos ).then( sanos => {
				if ( sanos.nombre === '') {
					rechaza( new modError.ErrorEstado( this.msj.faltaNombre, 400 ) );
					return false;
				}
				if ( sanos.apellido === '') {
					rechaza( new modError.ErrorEstado( this.msj.faltaApellido, 400 ) );
					return;
				}
				if ( !this.emailRegex.test( sanos.email ) ) {
					rechaza( new modError.ErrorEstado( this.msj.errCorreo, 400 ) );
					return;
				}
				if ( sanos.clave1 === '' || sanos.clave2 === '' || sanos.clave1 !== sanos.clave2 ) {
					rechaza( new modError.ErrorEstado( this.msj.clavesNoIgualesOVacias, 400 ) );
					return;
				}
				resuelve( sanos );
				return;
			}).catch( error => { rechaza( error ) } );
		});
	}

	crearToken( uid ) {
		return new Promise( ( resuelve, rechaza ) => {
			// Crea y guarda token en la tabla de usuario
			let token = crypto.randomBytes(16).toString('hex');
			db.consulta("update usuarios set token = ? where id = ? limit 1", [token, uid] )
			.then( () => {
				resuelve( token );
			}).catch( error => {
				rechaza( new modError.ErrorEstado( this.msj.errCreandoToken, 500 ) );
			});
		});
	}

	imagenRedim( archivo, archivoNuevo, anchoNuevo, altoNuevo ) {
		const { exec } = require('child_process');
		const cl = `convert ${archivo} -resize ${anchoNuevo}x${altoNuevo}^ -gravity center -extent ${anchoNuevo}x${altoNuevo} ${archivoNuevo}`;
		return new Promise( ( resuelve, rechaza ) => {
			exec( cl, ( error, stdout, stderr ) => {
				if ( error ) {
					modError.logError( JSON.stringify( error ) );
					rechaza();
					return;
				}
				resuelve();
				return;
			});
		});
	}

};
