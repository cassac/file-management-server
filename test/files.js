process.env.TESTING = true;
const request = require('supertest');
const chai = require('chai');  
const assert = chai.assert;  
const expect = chai.expect;  
const should = chai.should();
const path = require('path');
const fs = require('fs');

const app = require('../index');
const User = require('../models/users');
const File = require('../models/files');
const util = require('../util/auth');
const config = require('../util/config');

const fakeAdmin = {username: 'admin', password: '123', isAdmin: true};
const fakeUser1 = {username: 'user1', password: '123'};
const fakeUser2 = {username: 'user2', password: '123'};

const fakeFile1 = {file: path.join(__dirname, 'assets', 'test.png'), comment: 'This is a test file.'};
const fakeFile2 = {file: path.join(__dirname, 'assets', 'test.pdf'), comment: 'This is another test file.'};
const fakeFile3 = {file: path.join(__dirname, 'assets', 'test.fail'), comment: 'This file will be rejected.'};

describe('File Model and API', () => {

  let admin, adminToken;
  let user1, user1Token, user1File;
  let user2, user2Token, user2File;

  before('Create fake users.', done => {
    User.create([fakeAdmin, fakeUser1, fakeUser2], () => {
      done();
    })   
  }); 

  before('Retrieve fake users.', done => {
    User.find({}).select('+isAdmin').exec()
      .then(users => {
        admin = users[0];
        adminToken = util.grantUserToken(admin);
        return users;
      })
      .then((users) => {
        user1 = users[1];
        user1Token = util.grantUserToken(user1);
        return users;
      })
      .then((users) => {
        user2 = users[2];
        user2Token = util.grantUserToken(user2);
      })
      .then(done);  
  }); 

  after('Remove fake users.', done => {    
    User.remove({}, () => done() );  
  });

  after('Remove fake files.', done => {    
    File.remove({}, () => done() );  
  });

  describe('File Model', () => {
    
    it('Should throw validation error if all requird fields not provided', done => {
      const data = {
        ownerId: user1._id,
        // contentType: 'Required, but intentionally ignored for this test',
        filePath: '/path/to/file',
        fileSize: 5000000,
        comment: 'Comments are optional.'
      };
      const file = new File(data);
      file.save()
        .catch(err => {
          assert.equal(err.name, 'ValidationError');
          done();
        });
    });

    it('Should successfully add file to database', done => {
      const data = {
        ownerId: user1._id,
        contentType: 'application/pdf',
        filePath: config.uploadPath('test.pdf'),
        fileSize: 5000000,
        comment: 'Comments are optional.'
      }
      const file = new File(data);
      file.save()
        .then(file => {
          user1File = file;
          file.ownerId = data.ownerId;
          file._id.should.exist;
          file.createdAt.should.exist;
          file.updatedAt.should.exist;
          assert.equal(file.createdAt, file.updatedAt);
          done();
        });
    });

  }); // end File Model

  describe('File API', () => {

    const testUnauthorized = (method, route, cb) => {
      eval(`
        request(app)
          .${method}('${route}')
          .end((err, res) => {
            res.text.should.equal('Unauthorized');
            res.status.should.equal(401);
            cb();
        });
      `);
    }

    const testForbidden = (method, route, cb) => {
      eval(`
        request(app)
          .${method}('${route}')
          .set('authorization', user1Token)
          .end((err, res) => {
            res.body.message.should.equal('Forbidden.');
            res.status.should.equal(403);
            cb();
          });
      `);
    }

    const testInvalidFile = (method, route, cb) => {
      eval(`
        request(app)
          .${method}('${route}')
          .set('authorization', user1Token)
          .end((err, res) => {
            res.body.message.should.equal('File not found. (ID: invalidFileId)');
            res.status.should.equal(404);
            cb();
          });
      `); 
    }

    describe('/users/:userId/files GET', () => {

      it('Unauthenticated user should be restricted', done => {
        testUnauthorized('get', `/api/users/${user1._id}/files`, done);
      });

      it('Authenticated user should NOT have access to other user\'s files', done => {
        testForbidden('get', `/api/users/${user2._id}/files`, done);
      });

      it('Authenticated user should have access to own files', done => {
        request(app)
          .get(`/api/users/${user1._id}/files`)
          .set('authorization', user1Token)
          .end((err, res) => {
            assert.equal(res.body.results[0].ownerId, user1._id);
            res.body.message.should.equal('Files retrieved.');
            res.status.should.equal(200);
            done();
          });
      });

      it('Authenticated admin should have access to any user\'s files', done => {
        request(app)
          .get(`/api/users/${user1._id}/files`)
          .set('authorization', adminToken)
          .end((err, res) => {
            assert.lengthOf(res.body.results, 1);
            res.body.message.should.equal('Files retrieved.');
            res.status.should.equal(200);
            done();
          });
      });

    }); // end /users/:userId/files GET

    describe('/users/:userId/files POST', () => {

      it('Unauthenticated user should be restricted', done => {
        testUnauthorized('post', `/api/users/${user1._id}/files`, done);
      });

      it('Authenticated user should NOT be able to POST to other user\'s files', done => {
        testForbidden('post', `/api/users/${user2._id}/files`, done);
      });

      it('User should successfully POST file to user\'s account', done => {
        request(app)
          .post(`/api/users/${user2._id}/files`)
          .set('authorization', user2Token)
          .attach('file', 'test/assets/test.png')
          .field('comment', 'my test picture file.')
          .end((err, res) => {
            user2File = res.body.results;
            assert.equal(res.body.results.ownerId, user2._id);
            assert.equal(res.body.results.filePath, config.uploadPath('test.png'));
            res.body.message.should.equal('File uploaded successfully.');
            res.body.results.contentType.should.equal('image/png');
            res.body.results.comment.should.equal('my test picture file.');
            res.status.should.equal(201);
            done();
          });
      });

      it('Admin should successfully POST file to user\'s account', done => {
        request(app)
          .post(`/api/users/${user2._id}/files`)
          .set('authorization', adminToken)
          .attach('file', 'test/assets/test.pdf')
          .field('comment', 'my test pdf file.')
          .end((err, res) => {
            assert.equal(res.body.results.ownerId, user2._id);
            assert.equal(res.body.results.filePath, config.uploadPath('test.pdf'));
            res.body.message.should.equal('File uploaded successfully.');
            res.body.results.contentType.should.equal('application/pdf');
            res.body.results.comment.should.equal('my test pdf file.');
            res.status.should.equal(201);
            done();
          });
      });

      it('POSTed files should exist in directory', done => {
        fs.stat(path.join(config.uploadDir, config.uploadPath('test.png')), (err, stats) => {
          if (err) throw err;
          fs.stat(path.join(config.uploadDir, config.uploadPath('test.pdf')), (err, stats) => {
            if (err) throw err;
            else done();
          });
        });
      });

      it('Should reject POST request when no file attached to request', done => {
        request(app)
          .post(`/api/users/${user2._id}/files`)
          .set('authorization', user2Token)
          .field('comment', 'my test picture file.')
          .end((err, res) => {
            res.body.message.should.equal('Comment and file field required in request.');
            res.status.should.equal(400);
            done();
          });
      });

      it('Should reject POST request when invalid file type attached to request', done => {
        request(app)
          .post(`/api/users/${user2._id}/files`)
          .set('authorization', user2Token)
          .attach('file', 'test/assets/test.fail')
          .field('comment', 'my fake file.')
          .end((err, res) => {
            res.body.message.should.equal('File type .fail not allowed.');
            res.status.should.equal(400);
            done();
          });
      });

    }); // end /users/:userId/files POST

    describe('/users/:userId/files/:fileId GET', () => {

      it('Unauthenticated user should be restricted', done => {
        testUnauthorized('get', `/api/users/${user1._id}/files`, done);
      });

      it('Authenticated user should NOT be able to GET other user\'s files', done => {
        testForbidden('get', `/api/users/${user2._id}/files`, done);
      });

      it('Should handle invalid file request', done => {
        testInvalidFile('get', `/api/users/${user1._id}/files/invalidFileId`, done);
      });

      it('Authenticated admin should have access to any user file', done => {
        request(app)
          .get(`/api/users/${user1._id}/files/${user1File._id}`)
          .set('authorization', adminToken)
          .end((err, res) => {
            res.body.message.should.equal('File retrieved.');
            res.status.should.equal(200);
            done();
          });
      });

      it('Authenticated user should have access to own file', done => {
        request(app)
          .get(`/api/users/${user1._id}/files/${user1File._id}`)
          .set('authorization', user1Token)
          .end((err, res) => {
            res.body.message.should.equal('File retrieved.');
            res.status.should.equal(200);
            done();
          });
      });


    }); // /users/:userId/files/:fileId GET  

    describe('/users/:userId/files/:fileId PUT', () => {
     
      it('Unauthenticated user should be restricted', done => {
        testUnauthorized('put', `/api/users/${user1._id}/files/fakeFileId`, done);
      });

      it('Authenticated user should NOT be able to PUT other user\'s files', done => {
        testForbidden('put', `/api/users/${user2._id}/files/fakeFileId`, done);
      });

      it('Should handle invalid file request', done => {
        testInvalidFile('put', `/api/users/${user1._id}/files/invalidFileId`, done);
      });

      it('User should be able to update file comment', done => {
        const data = {'comment': 'the user\'s new comment'};
        request(app)
          .put(`/api/users/${user1._id}/files/${user1File._id}`)
          .set('authorization', user1Token)
          .send(data)
          .end((err, res) => {
            res.body.results.comment.should.equal(data.comment);
            res.body.message.should.equal('File updated.');
            res.status.should.equal(200);
            done();
          });
      });

      it('Admin should be able to update user\'s file comment', done => {
        const data = {'comment': 'the admin\'s new comment'};
        request(app)
          .put(`/api/users/${user1._id}/files/${user1File._id}`)
          .set('authorization', adminToken)
          .send(data)
          .end((err, res) => {
            res.body.results.comment.should.equal(data.comment);
            res.body.message.should.equal('File updated.');
            res.status.should.equal(200);
            done();
          });
      });

    }); // /users/:userId/files/:fileId PUT

    describe('/users/:userId/files/:fileId DELETE', () => {

      it('Unauthenticated user should be restricted', done => {
        testUnauthorized('delete', `/api/users/${user1._id}/files/fakeFileId`, done);
      });

      it('Authenticated user should NOT be able to DELETE other user\'s files', done => {
        testForbidden('delete', `/api/users/${user2._id}/files/fakeFileId`, done);
      });

      it('Should handle invalid file request', done => {
        testInvalidFile('delete', `/api/users/${user1._id}/files/invalidFileId`, done);
      });

      it('User should successfully DELETE own file', done => {
        request(app)
          .delete(`/api/users/${user1._id}/files/${user1File._id}`)
          .set('authorization', user1Token)
          .end((err, res) => {
            res.body.message.should.equal('File deleted.');
            res.status.should.equal(200);
            done();
          });
      });

      it('Admin should successfully DELETE user\'s file', done => {
        request(app)
          .delete(`/api/users/${user2._id}/files/${user2File._id}`)
          .set('authorization', adminToken)
          .end((err, res) => {
            res.body.message.should.equal('File deleted.');
            res.status.should.equal(200);
            done();
          });
      });

      it('DELETEed file (user1) should not exist in database', done => {
        request(app)
          .get(`/api/users/${user1._id}/files/${user1File._id}`)
          .set('authorization', user1Token)
          .end((err, res) => {
            res.body.message.should.equal(`File not found. (ID: ${user1File._id})`);
            res.status.should.equal(404);
            done();
          });
      });

      it('DELETEed file (user2) should not exist in database', done => {
        request(app)
          .get(`/api/users/${user2._id}/files/${user2File._id}`)
          .set('authorization', user2Token)
          .end((err, res) => {
            res.body.message.should.equal(`File not found. (ID: ${user2File._id})`);
            res.status.should.equal(404);
            done();
          });
      });

      it('DELETEed files should not exist in directory', done => {
        fs.stat(path.join(config.uploadDir, config.uploadPath('test.png')), (err, stats) => {
          err.code.should.equal('ENOENT');    
          fs.stat(path.join(config.uploadDir, config.uploadPath('test.pdf')), (err, stats) => {
            err.code.should.equal('ENOENT');            
            done();
          });
        });
      });  

    }); // end /users/:userId/files/:fileId DELETE

    describe('/files GET', () => {

      it('Unauthenticated user should be restricted', done => {
        testUnauthorized('get', '/api/files', done);
      });

      it('Authenticated user should NOT be able to GET files', done => {
        testForbidden('get', '/api/files', done);
      });

      it('Authenticated admin should have access to all files', done => {
        request(app)
          .get('/api/files')
          .set('authorization', adminToken)
          .end((err, res) => {
            assert.lengthOf(res.body.results, 1);
            res.body.message.should.equal('Files retrieved.');
            res.status.should.equal(200);
            done();
          });
      });  

    }); // end /files GET

  }); // end File API

});