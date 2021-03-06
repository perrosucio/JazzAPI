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

'use strict'

let url = require('url')
let conf = require('../../apis-comun/config')
let fs = require('fs')
let mkdirp = require('mkdirp')
let respuestas = require('../../apis-comun/respuestas')
let modError = require('../../apis-comun/error')
let imgsPermitidas = [ { ext: 'jpg', mime: 'image/jpeg' }, { ext: 'png', mime: 'image/png' } ]
let carpetasPermitidas = ['contenidos', 'banco']

module.exports = (req, res) => {
  let msj = require('./idiomas/' + req.idioma)
  require('../../apis-comun/usr-ok')(req).then(usuario => {
    if (usuario.esAdmin === 1) {
      let ruta = url.parse(req.url).pathname

      let aRuta = ruta.split('/')
      if (!aRuta[4]) {
        throw new modError.ErrorEstado(msj.faltaCarpeta, 400)
      } else {
        // Sanea recurso
        let carpetaOk = false
        for (let carpeta of carpetasPermitidas) {
          if (carpeta === aRuta[4]) {
            carpetaOk = true
            break
          }
        }
        if (!carpetaOk) {
          throw new modError.ErrorEstado(msj.carpetaNoPermitida, 400)
        }
      }
      let imagen = new Imagen(req, res)
      // /apis/wm-imagen/v1/<carpeta>
      if (req.method === 'GET') imagen.listar(aRuta)
      // /apis/wm-imagen/v1/<carpeta>
      else if (req.method === 'POST') imagen.crear(aRuta)
      // /apis/wm-imagen/v1/<carpeta>/ archivo ??????
      else if (req.method === 'DELETE') {
        if (!aRuta[5]) {
          throw new modError.ErrorEstado(msj.faltaNombreImagen, 400)
        }
        imagen.borrar(aRuta)
      } else modError.responderError(405, msj.metodoNoValido, res)
    }
  })
    .catch(error => {
      if (error.estado) {
        if (error.estado === 403) {
          modError.responderError(error.estado, msj.usrNoAutori, res)
        } else {
          modError.responderError(error.estado, error.message, res)
        }
      } else {
        modError.logError(error.name + ' ' + error.message + '\n' + error.stack)
        modError.responderError(500, msj.errServidorVerLog, res)
      }
    })
}

class Imagen {
  constructor (req, res, usr) {
    this.req = req
    this.res = res
    // Obtiene mensajes en el idioma del header
    this.msj = require('./idiomas/' + req.idioma)
  }

  listar (aRuta) {
    fs.readdir(conf.dirBaseImagen + aRuta[4], (error, archivos) => {
      if (error) {
        if (error.code === 'ENOENT') respuestas.responder(200, [], this.res) // No hay carpeta con imágenes
        else modError.manejarError(error, this.msj.errRecupeDatos, this.res)
      } else {
        // Filtra extensiones permitidas
        let imgOk
        let i = archivos.length
        while (i--) {
          for (let img of imgsPermitidas) {
            imgOk = archivos[i].substr(-3) === img.ext
            if (imgOk) break
          }
          if (!imgOk) archivos.splice(i, 1)
        }
        // Ordena archivos por fecha y hora
        archivos = archivos.map(archivo => {
          return {
            name: archivo,
            time: fs.statSync(conf.dirBaseImagen + aRuta[4] + '/' + archivo).mtime.getTime()
          }
        })
          .sort((a, b) => b.time - a.time)
          .map(v => v.name)
        // Agrega protocolo, dominio y ruta
        archivos.forEach((archivo, i, array) => {
          array[i] = conf.urlBaseImagen + aRuta[4] + '/' + archivo
        })
        //
        respuestas.responder(200, archivos, this.res)
      }
    })
  }

  crear (aRuta) {
    let archivo, oRuta, nombreArchivo, extArchivo
    Promise.resolve({ dir: conf.dirBaseImagen + aRuta[4] + '/', url: conf.urlBaseImagen + aRuta[4] + '/' }).then(ruta => {
      oRuta = ruta
      return mkdirp(oRuta.dir) // Crea carpetas necesarias
    }).then(() => {
      let cuerpo
      try {
        cuerpo = JSON.parse(this.req.cuerpo) // Obtiene info del archivo
      } catch (error) { throw new modError.ErrorEstado(this.msj.cuerpoNoJson, 400) }
      archivo = cuerpo.archivo
      // Verifica tipo de archivo
      // NOTA: La cadena en archivo.tipo no "garantiza" que el contenido del archivo sea del tipo
      let imgOk
      for (let img of imgsPermitidas) {
        imgOk = archivo.tipo === img.mime
        if (imgOk) {
          extArchivo = img.ext
          break
        }
      }
      if (imgOk) {
        let posPunto = archivo.nombre.lastIndexOf('.')
        nombreArchivo = archivo.nombre.substr(0, posPunto)
        nombreArchivo = this.cadena2url(nombreArchivo) // Obtien nombre de archivo saneado y sin extención
        if (posPunto > 0 && nombreArchivo !== '') { // Si queda algo del nombre después del saneo
          // Crea set de imágenes
          return new Promise((resolve, reject) => {
            this.crearSetImagenes('tmp/' + archivo.nombreTmp, oRuta.dir + nombreArchivo, extArchivo, ok => {
              if (ok) resolve(true)
              else reject(new modError.ErrorEstado(this.msj.errorCreandoSetImg, 500))
            })
          })
        } else {
          throw new modError.ErrorEstado(this.msj.errorNombreArchivo, 400)
        }
      } else {
        throw new modError.ErrorEstado(this.msj.debeSerJpgPng, 400)
      }
    }).then(() => {
      respuestas.responder(200, { url: oRuta.url + nombreArchivo + '.' + extArchivo }, this.res)
      // Elimina archivo temporal
      fs.unlink('tmp/' + archivo.nombreTmp, (error) => {
        if (error) modError.logError(error)
      })
    }).catch(error => {
      modError.manejarError(error, this.msj.errorCreandoSetImg, this.res)
      // Elimina archivo temporal
      fs.unlink('tmp/' + archivo.nombreTmp, (error) => {
        if (error) modError.logError(error)
      })
    })
  }

  borrar (aRuta) {
    let oRuta

    let archivo = aRuta[5] || ''
    if (archivo === '') {
      modError.responderError(400, this.msj.errorNombreArchivo, this.res)
      return
    }
    let nomArchivo = archivo.substr(0, archivo.length - 4)
    let extArchivo = archivo.substr(-4)

    Promise.resolve({ dir: conf.dirBaseImagen + aRuta[4] + '/', url: conf.urlBaseImagen + aRuta[4] + '/' }).then(ruta => {
      oRuta = ruta
      return new Promise((resolve, reject) => {
        fs.readdir(oRuta.dir, (error, archivos) => {
          if (error) reject(error)
          else resolve(archivos)
        })
      })
    }).then(archivos => {
      // Elimina los archivos del set de imágenes
      archivos.forEach(archivo => {
        conf.setDeImagenes.forEach(infoImg => {
          if (archivo === nomArchivo + infoImg.sufijo + extArchivo) {
            fs.unlink(oRuta.dir + archivo, error => {
              if (error) modError.logError(error)
            })
          }
        })
      })
      respuestas.responder(204, {}, this.res)
    }).catch(error => {
      if (error.code === 'ENOENT') { // Si la carpeta no existe
        respuestas.responder(204, {}, this.res) // se dan por borrados los archivos
      } else {
        modError.manejarError(error, this.msj.errorBorrandoSetImg, this.res)
      }
    })
  }

  // -----

  cadena2url (cadena) {
    let cambiaesto = ' ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøüùúûýýþÿ'
    let poresto = '-aaaaaaaceeeeiiiidnoooooouuuuybsaaaaaaaceeeeiiiidnoooooouuuuyyby'
    let expReg = /[\sÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøüùúûýýþÿ]/g
    let temp = cadena.replace(expReg, coincidencia => poresto[ cambiaesto.indexOf(coincidencia) ])
    return temp.toLowerCase().replace(/[^-a-z0-9]/g, '')
  }

  crearSetImagenes (origen, destino, extension, callback) {
    let banderaError = false
    let contador = conf.setDeImagenes.length
    let imagenRedim = (archivo, archivoNuevo, anchoNuevo, altoNuevo) => {
      const { exec } = require('child_process')
      const cl = `convert -background none ${archivo} -resize ${anchoNuevo}x${altoNuevo}^ -gravity center -extent ${anchoNuevo}x${altoNuevo} ${archivoNuevo}`
      return new Promise((resolve, reject) => {
        exec(cl, (error, stdout, stderr) => {
          if (error) {
            modError.logError(error)
            return resolve(false)
          }
          fs.chmod(archivoNuevo, '644', error => {
            if (error) modError.logError('Error setendo permisos de archivo a la imagen en /apis/wm-imagen/v1/principal.js\n' + error)
            return resolve(true)
          })
        })
      })
    }
    conf.setDeImagenes.forEach(infoImg => {
      imagenRedim(origen, destino + infoImg.sufijo + '.' + extension, infoImg.ancho, infoImg.alto) // Crea imagen nueva
        .then(ok => {
          banderaError = !ok ? true : banderaError
          contador--
          if (contador === 0) { // Ya se creó la última imagen
            if (banderaError) {
              if (typeof callback === 'function') callback(false)
            } else {
              if (typeof callback === 'function') callback(true)
            }
          }
        })
    })
  }
}
